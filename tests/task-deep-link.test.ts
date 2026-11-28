import fc from 'fast-check';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GET as startOAuth } from '@/app/api/auth/github/route';
import { GET as callback } from '@/app/api/auth/github/callback/route';
import { taskLoginReturnTo } from '@/lib/task-deep-link';
import { createMigratedDatabase, type TestD1Database } from './support/d1';
import { configureEnvironment, origin } from './support/fixtures';

let database: TestD1Database;
beforeEach(() => {
  database = createMigratedDatabase();
  configureEnvironment(database);
  Object.assign(env, {
    ALLOWED_GITHUB_LOGINS: '',
    ALLOWED_GITHUB_ORGS: '',
    ALLOWED_GITHUB_TEAMS: '',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  database.close();
});

it('retains notification references, including legacy IDs', () => {
  expect(taskLoginReturnTo('xapi', 'KANBY-144')).toBe(
    '/xapi/board?task=KANBY-144',
  );
  expect(taskLoginReturnTo('xapi', 'b0f93050')).toBe(
    '/xapi/board?task=b0f93050',
  );
});

it('keeps existing login destinations when no task was requested', () => {
  expect(taskLoginReturnTo('xapi', null)).toBe('/xapi/board');
  expect(taskLoginReturnTo(undefined, null)).toBe('/');
  expect(taskLoginReturnTo('team/project', null)).toBe('/team%2Fproject/board');
});

it('keeps arbitrary task references as one local query value', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), (reference) => {
      const path = taskLoginReturnTo('xapi', reference);
      const url = new URL(path, origin);
      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe('/xapi/board');
      expect([...url.searchParams]).toEqual([['task', reference]]);
      expect(url.hash).toBe('');
    }),
    { seed: 20261128 },
  );
  expect(taskLoginReturnTo(undefined, 'KANBY-144')).toBe('/?task=KANBY-144');
});

it('returns to the exact task after the complete OAuth route exchange', async () => {
  const returnTo = taskLoginReturnTo('xapi', 'KANBY-144');
  const started = await startOAuth(
    new Request(
      `${origin}/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
    ),
  );
  expect(started.status).toBe(302);
  const state = new URL(started.headers.get('location')!).searchParams.get(
    'state',
  );
  const cookie = started.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === 'https://github.com/login/oauth/access_token')
        return Response.json({ access_token: 'test-access-token' });
      if (url === 'https://api.github.com/user')
        return Response.json({
          id: 42,
          login: 'alice',
          name: 'Alice',
          avatar_url: 'https://avatars.githubusercontent.com/u/42',
        });
      if (
        url.includes('/user/emails') ||
        url.includes('/user/memberships/orgs')
      )
        return Response.json([]);
      throw new Error(`Unexpected GitHub request: ${url}`);
    }),
  );
  const response = await callback(
    new Request(
      `${origin}/api/auth/github/callback?code=test-code&state=${encodeURIComponent(state!)}`,
      { headers: { Cookie: cookie } },
    ),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(
    `${origin}/xapi/board?task=KANBY-144`,
  );
});
