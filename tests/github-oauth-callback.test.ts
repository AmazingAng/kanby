import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as githubCallback } from '@/app/api/auth/github/callback/route';
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from '@/lib/auth';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import { configureEnvironment, origin } from './support/fixtures';

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
