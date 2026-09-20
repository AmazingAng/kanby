import { getSessionUser } from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import { metricsResponse } from '@/lib/team-metrics-response';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  if (!user || !projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json(
      { ok: false, error: { message: 'Forbidden' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  return metricsResponse(request, projectId);
}
