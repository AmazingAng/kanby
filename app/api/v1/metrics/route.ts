import { authenticateAgent } from '@/lib/agent';
import { metricsResponse } from '@/lib/team-metrics-response';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const identity = await authenticateAgent(request, 'task:read');
  if (!identity)
    return Response.json(
      {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid, expired, or insufficiently scoped Agent Token',
        },
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  return metricsResponse(request, identity.projectId);
}
