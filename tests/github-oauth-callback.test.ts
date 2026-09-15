import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as githubCallback } from '@/app/api/auth/github/callback/route';
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from '@/lib/auth';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import { configureEnvironment, origin, seedProject } from './support/fixtures';

const state = 'test-oauth-state';
const verifier = 'test-pkce-verifier';

function callbackRequest(code = 'test-code') {
  return new Request(
    `${origin}/api/auth/github/callback?code=${code}&state=${state}`,
    {
      headers: {
        Cookie: `${OAUTH_STATE_COOKIE}=${state}; ${OAUTH_VERIFIER_COOKIE}=${verifier}`,
      },
    },
  );
}

describe('GitHub OAuth callback on Cloudflare Workers', () => {
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

  it('uses the Worker-compatible no-follow mode for every GitHub request', async () => {
    const requests: Array<{ url: string; redirect?: RequestRedirect }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push({
          url,
          redirect:
            init?.redirect ??
            (input instanceof Request ? input.redirect : undefined),
        });
        if (url === 'https://github.com/login/oauth/access_token') {
          return Response.json({ access_token: 'test-access-token' });
        }
        if (url === 'https://api.github.com/user') {
          return Response.json({
            id: 42,
            login: 'alice',
            name: 'Alice',
            avatar_url: 'https://avatars.githubusercontent.com/u/42',
          });
        }
        if (url.includes('/user/emails')) {
          return Response.json([
            { email: 'alice@example.test', verified: true },
          ]);
        }
        if (url.includes('/user/memberships/orgs')) return Response.json([]);
        throw new Error(`Unexpected GitHub request: ${url}`);
      }),
    );

    const response = await githubCallback(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(origin);
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.redirect === 'manual')).toBe(
      true,
    );
  });

  it('allows an existing project member by immutable GitHub user id', async () => {
    seedProject(database);
    const now = 1_700_000_000_000;
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .run('42', 'old-login', 'Old Name', now, now);
    database.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('project-1', '42', 'member', ?)",
      )
      .run(now);
    Object.assign(env, { ALLOWED_GITHUB_LOGINS: 'owner-only' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://github.com/login/oauth/access_token')
          return Response.json({ access_token: 'test-access-token' });
        if (url === 'https://api.github.com/user')
          return Response.json({
            id: 42,
            login: 'renamed-member',
            name: 'Renamed Member',
            avatar_url: 'https://avatars.githubusercontent.com/u/42',
          });
        if (url.includes('/user/emails')) return Response.json([]);
        if (url.includes('/user/memberships/orgs')) return Response.json([]);
        throw new Error(`Unexpected GitHub request: ${url}`);
      }),
    );

    const response = await githubCallback(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('tinyship_session=');
    expect(
      database.sqlite
        .prepare('SELECT login, name FROM users WHERE id = ?')
        .get('42'),
    ).toEqual({ login: 'renamed-member', name: 'Renamed Member' });
  });

  it('denies a removed member whose only invitation is historical', async () => {
    seedProject(database);
    const now = 1_700_000_000_000;
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .run('42', 'former-member', 'Former Member', now, now);
    database.sqlite
      .prepare(
        "INSERT INTO project_invitations (id, project_id, identity, invited_by, created_at, accepted_at) VALUES ('invite-1', 'project-1', 'former-member', 'user-1', ?, ?)",
      )
      .run(now, now);
    Object.assign(env, { ALLOWED_GITHUB_LOGINS: 'owner-only' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://github.com/login/oauth/access_token')
          return Response.json({ access_token: 'test-access-token' });
        if (url === 'https://api.github.com/user')
          return Response.json({
            id: 42,
            login: 'former-member',
            name: 'Former Member',
            avatar_url: null,
          });
        if (url.includes('/user/emails')) return Response.json([]);
        if (url.includes('/user/memberships/orgs')) return Response.json([]);
        throw new Error(`Unexpected GitHub request: ${url}`);
      }),
    );

    const response = await githubCallback(callbackRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('denies a GitHub account without membership, invitation, or allowlist match', async () => {
    Object.assign(env, { ALLOWED_GITHUB_LOGINS: 'owner-only' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://github.com/login/oauth/access_token')
          return Response.json({ access_token: 'test-access-token' });
        if (url === 'https://api.github.com/user')
          return Response.json({
            id: 99,
            login: 'outsider',
            name: 'Outsider',
            avatar_url: null,
          });
        if (url.includes('/user/emails')) return Response.json([]);
        if (url.includes('/user/memberships/orgs')) return Response.json([]);
        throw new Error(`Unexpected GitHub request: ${url}`);
      }),
    );

    const response = await githubCallback(callbackRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('allows a pending invitation and activates project membership', async () => {
    seedProject(database);
    const now = 1_700_000_000_000;
    database.sqlite
      .prepare(
        "INSERT INTO project_invitations (id, project_id, identity, invited_by, created_at, accepted_at) VALUES ('invite-1', 'project-1', 'invited-user', 'user-1', ?, NULL)",
      )
      .run(now);
    Object.assign(env, { ALLOWED_GITHUB_LOGINS: 'owner-only' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://github.com/login/oauth/access_token')
          return Response.json({ access_token: 'test-access-token' });
        if (url === 'https://api.github.com/user')
          return Response.json({
            id: 43,
            login: 'invited-user',
            name: 'Invited User',
            avatar_url: null,
          });
        if (url.includes('/user/emails')) return Response.json([]);
        if (url.includes('/user/memberships/orgs')) return Response.json([]);
        throw new Error(`Unexpected GitHub request: ${url}`);
      }),
    );

    const response = await githubCallback(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('tinyship_session=');
    expect(
      database.sqlite
        .prepare(
          "SELECT role FROM project_members WHERE project_id = 'project-1' AND user_id = '43'",
        )
        .get(),
    ).toEqual({ role: 'member' });
    expect(
      database.sqlite
        .prepare(
          "SELECT accepted_at FROM project_invitations WHERE id = 'invite-1'",
        )
        .get(),
    ).toEqual({ accepted_at: expect.any(Number) });
  });

  it('turns a token endpoint redirect into a safe OAuth error', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://example.invalid/intercept' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await githubCallback(callbackRequest('redirecting-code'));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('GitHub 授权失败');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns a profile endpoint redirect into a safe OAuth error', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual');
        if (fetchMock.mock.calls.length === 1) {
          return Response.json({ access_token: 'test-access-token' });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://example.invalid/intercept' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await githubCallback(callbackRequest());

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('无法读取 GitHub 用户资料。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
