import { authenticateAgent } from '@/lib/agent';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const identity = await authenticateAgent(request, 'task:read');
  if (!identity)
    return Response.json(
      {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid or expired Agent Token',
        },
      },
      { status: 401 },
    );
  return Response.json(
    {
      ok: true,
      data: [
        {
          id: identity.projectId,
          name: identity.projectName,
          slug: identity.projectSlug,
          role: 'agent',
        },
      ],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
