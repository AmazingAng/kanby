import { getAuthConfig, getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const configured = Boolean(getAuthConfig());
  const user = configured ? await getSessionUser(request) : null;
  return Response.json(
    { configured, user },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
