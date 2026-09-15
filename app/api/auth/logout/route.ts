import {
  clearCookieHeader,
  getAuthConfig,
  isSameOriginMutation,
  SESSION_COOKIE,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = getAuthConfig();
  if (!config || !isSameOriginMutation(request, config))
    return new Response('Forbidden', { status: 403 });
  const headers = new Headers({
    Location: config.publicBaseUrl,
    'Cache-Control': 'no-store',
  });
  headers.set(
    'Set-Cookie',
    clearCookieHeader(
      SESSION_COOKIE,
      config.origin.startsWith('https://'),
      config.basePath,
    ),
  );
  return new Response(null, { status: 303, headers });
}
