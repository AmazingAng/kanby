import {
  clearCookieHeader,
  cookieHeader,
  createSessionToken,
  getAuthConfig,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  readCookie,
  SESSION_COOKIE,
  type AuthUser,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

type GitHubUser = { id?: number; login?: string; name?: string | null; avatar_url?: string | null };

export async function GET(request: Request) {
  const config = getAuthConfig();
  if (!config) return new Response('GitHub 登录尚未配置。', { status: 503 });
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const verifier = readCookie(request, OAUTH_VERIFIER_COOKIE);
  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return new Response('登录校验失败，请返回重试。', { status: 400 });
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${config.origin}/api/auth/github/callback`,
      code_verifier: verifier,
    }),
  });
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return new Response(`GitHub 授权失败：${tokenPayload.error ?? 'unknown_error'}`, { status: 400 });
  }

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'User-Agent': 'tinyship-kanban',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const profile = (await profileResponse.json()) as GitHubUser;
  if (!profileResponse.ok || !profile.id || !profile.login) {
    return new Response('无法读取 GitHub 用户资料。', { status: 400 });
  }
  if (config.allowedLogins.size > 0 && !config.allowedLogins.has(profile.login.toLowerCase())) {
    return new Response('此 GitHub 账号不在 tinyship 团队名单中。', { status: 403 });
  }

  const user: AuthUser = {
    id: String(profile.id),
    login: profile.login,
    name: profile.name?.trim() || profile.login,
    avatarUrl: profile.avatar_url || null,
  };
  const session = await createSessionToken(user, config.sessionSecret);
  const secure = config.origin.startsWith('https://');
  const headers = new Headers({ Location: config.origin, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookieHeader(SESSION_COOKIE, session, { maxAge: 60 * 60 * 24 * 30, secure }));
  headers.append('Set-Cookie', clearCookieHeader(OAUTH_STATE_COOKIE, secure));
  headers.append('Set-Cookie', clearCookieHeader(OAUTH_VERIFIER_COOKIE, secure));
  return new Response(null, { status: 302, headers });
}
