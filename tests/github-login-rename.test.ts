import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as inviteMember } from '@/app/api/members/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  inviteProjectMember,
  registerOAuthUser,
  touchSessionUser,
} from '@/lib/db';
import { resolveGitHubLogin } from '@/lib/github';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  sessionSecret,
} from './support/fixtures';

function users(database: TestD1Database) {
  return database.sqlite
    .prepare('SELECT id, login FROM users ORDER BY id')
    .all() as { id: string; login: string }[];
}

function members(database: TestD1Database) {
  return database.sqlite
    .prepare(
      "SELECT user_id FROM project_members WHERE project_id = 'project-1' ORDER BY user_id",
    )
    .all() as { user_id: string }[];
}

describe('GitHub login renames', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it('lets a new holder of a renamed login sign in and refreshes logins by id', async () => {
    await registerOAuthUser({
      id: '100',
      login: 'foo',
      name: 'Old Foo',
      avatarUrl: null,
    });
    // GitHub user 100 renamed to "bar"; user 200 now owns "foo".
    await registerOAuthUser({
      id: '200',
      login: 'Foo',
      name: 'New Foo',
      avatarUrl: null,
    });
    expect(users(database)).toEqual([
      { id: '100', login: '#100' },
      { id: '200', login: 'foo' },
      { id: 'user-1', login: 'alice' },
    ]);
    await registerOAuthUser({
      id: '100',
      login: 'bar',
      name: 'Old Foo',
      avatarUrl: null,
    });
    expect(users(database)[0]).toEqual({ id: '100', login: 'bar' });
  });

  it('adds the current holder of a login, never the stale row', async () => {
    await registerOAuthUser({
      id: '100',
      login: 'foo',
      name: 'Old Foo',
      avatarUrl: null,
    });

    // "foo" now belongs to GitHub user 300, who has never signed in.
    const result = await inviteProjectMember(
      'project-1',
      'user-1',
      '@foo',
      async () => ({ kind: 'found', id: '300', login: 'foo' }),
    );
    expect(result).toBe('invited');
    expect(members(database)).toEqual([{ user_id: 'user-1' }]);
    expect(users(database)[0]).toEqual({ id: '100', login: '#100' });

    await registerOAuthUser({
      id: '300',
      login: 'foo',
      name: 'Foo',
      avatarUrl: null,
    });
    expect(members(database)).toEqual([
      { user_id: '300' },
      { user_id: 'user-1' },
    ]);
  });

  it('never lets a stale session cookie take a login or its invitations back', async () => {
    await registerOAuthUser({
      id: '100',
      login: 'alice',
      name: 'A',
      avatarUrl: null,
    });
    // 100 renamed on GitHub; 200 took "alice" and signed in.
    await registerOAuthUser({
      id: '200',
      login: 'alice',
      name: 'B',
      avatarUrl: null,
    });
    // An invitation to @alice made while GitHub was unreachable (unbound).
    await inviteProjectMember('project-1', 'user-1', 'alice', async () => ({
      kind: 'unavailable',
    }));
    // 100 opens the app with its 30-day-old cookie that still says "alice".
    await touchSessionUser({
      id: '100',
      login: 'alice',
      name: 'A',
      avatarUrl: null,
    });

    expect(users(database).slice(0, 2)).toEqual([
      { id: '100', login: '#100' },
      { id: '200', login: 'alice' },
    ]);
    expect(members(database)).toEqual([{ user_id: 'user-1' }]);
    // The invitation is accepted by the current holder at OAuth sign-in.
    await registerOAuthUser({
      id: '200',
      login: 'alice',
      name: 'B',
      avatarUrl: null,
    });
    expect(members(database)).toEqual([
      { user_id: '200' },
      { user_id: 'user-1' },
    ]);
  });

  it('binds a resolved invitation to the GitHub id, not to the login', async () => {
    // "carol" resolves to GitHub user 300, who has not signed up yet.
    await inviteProjectMember('project-1', 'user-1', 'carol', async () => ({
      kind: 'found',
      id: '300',
      login: 'carol',
    }));
    // 300 renames to "caroline"; someone else (400) takes "carol" and signs in.
    await registerOAuthUser({
      id: '400',
      login: 'carol',
      name: 'X',
      avatarUrl: null,
    });
    expect(members(database)).toEqual([{ user_id: 'user-1' }]);
    await registerOAuthUser({
      id: '300',
      login: 'caroline',
      name: 'C',
      avatarUrl: null,
    });
    expect(members(database)).toEqual([
      { user_id: '300' },
      { user_id: 'user-1' },
    ]);
  });

  it('creates a session-only user without taking a held login', async () => {
    await registerOAuthUser({
      id: '200',
      login: 'alice',
      name: 'B',
      avatarUrl: null,
    });
    await touchSessionUser({
      id: '500',
      login: 'alice',
      name: 'Z',
      avatarUrl: null,
    });
    expect(users(database).find((row) => row.id === '500')).toEqual({
      id: '500',
      login: '#500',
    });
  });

  it('adds a registered user directly when GitHub confirms the login', async () => {
    await registerOAuthUser({
      id: '100',
      login: 'foo',
      name: 'Foo',
      avatarUrl: null,
    });
    expect(
      await inviteProjectMember('project-1', 'user-1', 'foo', async () => ({
        kind: 'found',
        id: '100',
        login: 'Foo',
      })),
    ).toBe('added');
    expect(members(database)).toEqual([
      { user_id: '100' },
      { user_id: 'user-1' },
    ]);
  });

  it('keeps the invitation pending when GitHub is unavailable and fails on unknown logins', async () => {
    await registerOAuthUser({
      id: '100',
      login: 'foo',
      name: 'Foo',
      avatarUrl: null,
    });
    expect(
      await inviteProjectMember('project-1', 'user-1', 'foo', async () => ({
        kind: 'unavailable',
      })),
    ).toBe('invited');
    expect(members(database)).toEqual([{ user_id: 'user-1' }]);
    expect(
      await inviteProjectMember('project-1', 'user-1', 'ghost', async () => ({
        kind: 'not_found',
      })),
    ).toBe('not_found');
  });

  it('returns 404 from the members API for an unknown GitHub login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const response = await inviteMember(
      new Request(`${origin}/api/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({ projectId: 'project-1', identity: 'ghost' }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('resolves logins through the GitHub users API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 42, login: 'Foo' }))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ id: null }));
    expect(await resolveGitHubLogin('foo', 'token')).toEqual({
      kind: 'found',
      id: '42',
      login: 'Foo',
    });
    expect(
      (fetchMock.mock.calls[0]![0] as Request).headers.get('Authorization'),
    ).toBe('Bearer token');
    expect(await resolveGitHubLogin('foo')).toEqual({ kind: 'unavailable' });
    expect(await resolveGitHubLogin('foo')).toEqual({ kind: 'unavailable' });
    expect(await resolveGitHubLogin('foo')).toEqual({ kind: 'unavailable' });
    expect(await resolveGitHubLogin('#bad')).toEqual({ kind: 'not_found' });
  });
});
