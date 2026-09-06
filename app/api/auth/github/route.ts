import {
  cookieHeader,
  getAuthConfig,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  randomToken,
  sha256Base64Url,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getAuthConfig();
  if (!config) return new Response('GitHub 登录尚未配置。', { status: 503 });

  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  const secure = config.origin.startsWith('https://');
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', `${config.origin}/api/auth/github/callback`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const headers = new Headers({ Location: authorize.toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookieHeader(OAUTH_STATE_COOKIE, state, { maxAge: 600, secure }));
  headers.append('Set-Cookie', cookieHeader(OAUTH_VERIFIER_COOKIE, verifier, { maxAge: 600, secure }));
  return new Response(null, { status: 302, headers });
}
