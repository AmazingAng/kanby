import { authenticateAgent, resolveAgentTask } from '@/lib/agent';
import { listTaskActivity } from '@/lib/task-activity';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const identity = await authenticateAgent(request, 'task:read');
  const fail = (message: string, status: number) =>
    Response.json(
      { ok: false, error: { message } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  if (!identity)
    return fail('Invalid, expired, or insufficiently scoped Agent Token', 401);
  const params = new URL(request.url).searchParams;
  const ref = params.get('task');
  const taskId = ref
    ? await resolveAgentTask(identity.projectId, ref)
    : undefined;
  if (ref && !taskId) return fail('Task not found', 404);
  const limit = Number(params.get('limit') ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return fail('Limit must be between 1 and 50', 400);
  try {
    const data = await listTaskActivity({
      projectId: identity.projectId,
      taskId: taskId ?? undefined,
      cursor: params.get('cursor'),
      limit,
    });
    return Response.json(
      { ok: true, data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid activity cursor')
      return fail(error.message, 400);
    throw error;
  }
}
