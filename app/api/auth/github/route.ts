import {
  cookieHeader,
  getAuthConfig,
  githubOAuthScopes,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  randomToken,
  safeReturnTo,
  sha256Base64Url,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = getAuthConfig();
  if (!config) return new Response('GitHub 登录尚未配置。', { status: 503 });

  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  const requestedReturnTo =
    new URL(request.url).searchParams.get('returnTo') ?? '/';
  const returnTo = safeReturnTo(requestedReturnTo);
  const secure = config.origin.startsWith('https://');
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set(
    'redirect_uri',
    `${config.publicBaseUrl}/api/auth/github/callback`,
  );
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', githubOAuthScopes(config).join(' '));
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const headers = new Headers({
    Location: authorize.toString(),
    'Cache-Control': 'no-store',
  });
  headers.append(
    'Set-Cookie',
    cookieHeader(OAUTH_STATE_COOKIE, state, {
      maxAge: 600,
      secure,
      path: config.basePath,
    }),
  );
  headers.append(
    'Set-Cookie',
    cookieHeader(OAUTH_VERIFIER_COOKIE, verifier, {
      maxAge: 600,
      secure,
      path: config.basePath,
    }),
  );
  headers.append(
    'Set-Cookie',
    cookieHeader(OAUTH_RETURN_TO_COOKIE, returnTo, {
      maxAge: 600,
      secure,
      path: config.basePath,
    }),
  );
  return new Response(null, { status: 302, headers });
}
