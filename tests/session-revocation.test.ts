import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as logout } from '@/app/api/auth/logout/route';
import { createSessionToken, getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { removeProjectMember } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  sessionSecret,
} from './support/fixtures';

const bob = { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null };

function withCookie(token: string, method = 'GET') {
  return new Request(`${origin}/api/auth/logout`, {
    method,
    headers: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: origin },
  });
}

async function legacyCookie(user: typeof bob) {
  // A cookie issued before session ids existed: same signature, no sid/iam.
  const encode = (value: string) => Buffer.from(value).toString('base64url');
  const iat = Math.floor(Date.now() / 1000) - 60;
  const payload = encode(JSON.stringify({ ...user, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  );
  return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}

describe('server-side session revocation', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    database.sqlite
      .prepare(
        "INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES ('user-2', 'bob', 'Bob', NULL, 1, 1)",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('project-1', 'user-2', 'member', 1)",
      )
      .run();
  });

  afterEach(() => {
    vi.useRealTimers();
    database.close();
  });

  it('logout invalidates that cookie immediately but not other sessions', async () => {
    const phone = await createSessionToken(bob, sessionSecret);
    const laptop = await createSessionToken(bob, sessionSecret);
    expect(await getSessionUser(withCookie(phone))).toMatchObject({
      id: 'user-2',
    });

    expect((await logout(withCookie(phone, 'POST'))).status).toBe(303);
    expect(await getSessionUser(withCookie(phone))).toBeNull();
    expect(await getSessionUser(withCookie(laptop))).not.toBeNull();
    // Logging out again is harmless.
    expect((await logout(withCookie(phone, 'POST'))).status).toBe(303);
  });

  it('removing a member signs them out everywhere, and a new sign-in works', async () => {
    const before = await createSessionToken(bob, sessionSecret);
    await removeProjectMember('project-1', 'user-2');
    expect(await getSessionUser(withCookie(before))).toBeNull();

    vi.useFakeTimers({ now: Date.now() + 5 });
    const after = await createSessionToken(bob, sessionSecret);
    expect(await getSessionUser(withCookie(after))).not.toBeNull();
  });

  it('logging out a legacy cookie without a session id revokes older sessions', async () => {
    const legacy = await legacyCookie(bob);
    expect(await getSessionUser(withCookie(legacy))).not.toBeNull();
    await logout(withCookie(legacy, 'POST'));
    expect(await getSessionUser(withCookie(legacy))).toBeNull();
    const fresh = await createSessionToken(bob, sessionSecret);
    expect(await getSessionUser(withCookie(fresh))).not.toBeNull();
  });

  it('fails closed when revocation cannot be checked', async () => {
    const token = await createSessionToken(bob, sessionSecret);
    database.exec('DROP TABLE session_revocations');
    expect(await getSessionUser(withCookie(token))).toBeNull();
  });
});
