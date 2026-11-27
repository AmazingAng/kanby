import { getSessionUser } from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import { listTurnQueue } from '@/lib/turns';

export const dynamic = 'force-dynamic';

/** The signed-in member's queue: their turns, their agents' turns and @mentions. */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const projectId =
    new URL(request.url).searchParams.get('projectId')?.trim() ?? '';
  if (!user || !projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    { items: await listTurnQueue({ projectId, userId: user.id }) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
