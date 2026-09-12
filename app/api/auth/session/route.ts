import { getAuthConfig, getSessionUser, publicAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const configured = Boolean(getAuthConfig());
  const user = configured ? await getSessionUser(request) : null;
  return Response.json(
    { configured, user: user ? publicAuthUser(user) : null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
