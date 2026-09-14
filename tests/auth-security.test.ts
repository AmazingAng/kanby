import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as sessionEndpoint } from '@/app/api/auth/session/route';
import {
  createSessionToken,
  getAuthConfig,
  getSessionUser,
  hasFreshAuthorizationClaims,
  publicAuthUser,
  readCookie,
  safeReturnTo,
  SESSION_COOKIE,
  cookieHeader,
} from '@/lib/auth';

const runtime = env as Record<string, unknown>;
const strongSecret = '0123456789abcdef0123456789abcdef';

function configureAuth(overrides: Record<string, string> = {}) {
  Object.assign(runtime, {
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: strongSecret,
    PUBLIC_APP_ORIGIN: 'https://kanby.test',
    PUBLIC_APP_BASE_PATH: '',
    ALLOWED_GITHUB_LOGINS: '',
    ALLOWED_GITHUB_ORGS: '',
    ALLOWED_GITHUB_TEAMS: '',
    ...overrides,
  });
}

describe('OAuth and session security boundaries', () => {
  beforeEach(() => configureAuth());
  afterEach(() => vi.useRealTimers());

  it('canonicalizes local OAuth return paths and rejects browser-normalized external targets', () => {
    expect(safeReturnTo('/settings?project=one#github')).toBe(
      '/settings?project=one#github',
    );
    expect(safeReturnTo('/demo')).toBe('/demo');

    for (const hostile of [
      'https://evil.test/steal',
      '//evil.test/steal',
      '/\\evil.test/steal',
      '\\evil.test/steal',
      'javascript:alert(1)',
      '',
    ]) {
      expect(safeReturnTo(hostile)).toBe('/');
    }
  });

  it('fails closed for malformed cookie encoding and extra session segments', async () => {
    const malformedCookie = new Request('https://kanby.test', {
      headers: { Cookie: `${SESSION_COOKIE}=%E0%A4%A` },
    });
    expect(readCookie(malformedCookie, SESSION_COOKIE)).toBeNull();
    await expect(getSessionUser(malformedCookie)).resolves.toBeNull();

    const token = await createSessionToken(
      {
        id: '42',
        login: 'alice',
        name: 'Alice',
        avatarUrl: null,
      },
      strongSecret,
    );
    const extraSegment = new Request('https://kanby.test', {
      headers: { Cookie: `${SESSION_COOKIE}=${token}.ignored` },
    });
    await expect(getSessionUser(extraSegment)).resolves.toBeNull();
  });

  it('requires a strong signing secret and a clean HTTPS production origin', () => {
    configureAuth({ SESSION_SECRET: 'x'.repeat(31) });
    expect(getAuthConfig()).toBeNull();

    configureAuth({ SESSION_SECRET: 'x'.repeat(32) });
    expect(getAuthConfig()).not.toBeNull();

    configureAuth({ PUBLIC_APP_ORIGIN: 'http://kanby.example' });
    expect(getAuthConfig()).toBeNull();

    for (const invalidOrigin of [
      'https://user:pass@kanby.test',
      'https://kanby.test/app',
      'https://kanby.test/?debug=1',
      'https://kanby.test/#debug',
    ]) {
      configureAuth({ PUBLIC_APP_ORIGIN: invalidOrigin });
      expect(getAuthConfig()).toBeNull();
    }

    configureAuth({ PUBLIC_APP_ORIGIN: 'http://localhost:3000' });
    expect(getAuthConfig()?.origin).toBe('http://localhost:3000');
    configureAuth({ PUBLIC_APP_ORIGIN: 'https://kanby.test/' });
    expect(getAuthConfig()?.origin).toBe('https://kanby.test');
  });

  it('builds a canonical public URL for path-routed deployments', () => {
    configureAuth({ PUBLIC_APP_BASE_PATH: '/w/702a5b1647a3/preview/' });
    expect(getAuthConfig()).toMatchObject({
      origin: 'https://kanby.test',
      basePath: '/w/702a5b1647a3/preview',
      publicBaseUrl: 'https://kanby.test/w/702a5b1647a3/preview',
    });
    expect(
      cookieHeader('state', 'value', {
        maxAge: 600,
        secure: true,
        path: getAuthConfig()?.basePath,
      }),
    ).toContain('Path=/w/702a5b1647a3/preview');
  });

  it('rejects malformed public base paths', () => {
    for (const invalidBasePath of [
      'w/preview',
      '//evil.test',
      '/w\\evil',
      '/w/preview?debug=1',
      '/w/preview#debug',
    ]) {
      configureAuth({ PUBLIC_APP_BASE_PATH: invalidBasePath });
      expect(getAuthConfig()).toBeNull();
    }
  });

  it('never serializes server-only GitHub administration claims', async () => {
    const user = {
      id: '42',
      login: 'alice',
      name: 'Alice',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      githubAdminAccountIds: ['42', '88'],
    };
    expect(publicAuthUser(user)).toEqual({
      id: '42',
      login: 'alice',
      name: 'Alice',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
    });

    const token = await createSessionToken(user, strongSecret);
    const response = await sessionEndpoint(
      new Request('https://kanby.test/api/auth/session', {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    const payload = (await response.json()) as {
      user: Record<string, unknown>;
    };
    expect(payload.user).toEqual(publicAuthUser(user));
    expect(payload.user).not.toHaveProperty('githubAdminAccountIds');
  });

  it('requires recent authentication before using organization-admin claims', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    const token = await createSessionToken(
      {
        id: '42',
        login: 'alice',
        name: 'Alice',
        avatarUrl: null,
        githubAdminAccountIds: ['88'],
      },
      strongSecret,
    );
    const request = () =>
      new Request('https://kanby.test', {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      });

    const fresh = await getSessionUser(request());
    expect(fresh && hasFreshAuthorizationClaims(fresh)).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    const stale = await getSessionUser(request());
    expect(stale && hasFreshAuthorizationClaims(stale)).toBe(false);

    vi.setSystemTime(new Date('2026-09-11T08:00:00Z'));
    await expect(getSessionUser(request())).resolves.toBeNull();
  });
});
