import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole, taskBelongsToProject } from '@/lib/db';
import { readTextBodyWithLimit } from '@/lib/request-limits';
import {
  appendTaskActivity,
  listProjectAgentStates,
  listTaskActivity,
  userActivityActor,
} from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

const MAX_COMMENT_REQUEST_BODY = 16 * 1024;

function queryIdentity(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    projectId: params.get('projectId')?.trim() ?? '',
    taskId: params.get('taskId')?.trim() ?? '',
    cursor: params.get('cursor'),
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const { projectId, taskId, cursor } = queryIdentity(request);
  if (!user || !projectId || !taskId)
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const [activity, states] = await Promise.all([
      listTaskActivity({ projectId, taskId, cursor }),
      listProjectAgentStates(projectId),
    ]);
    return Response.json(
      {
        ...activity,
        agentState: states.find((state) => state.taskId === taskId) ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid activity cursor')
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const raw = await readTextBodyWithLimit(request, MAX_COMMENT_REQUEST_BODY);
  if (!raw.ok)
    return Response.json(
      {
        error: raw.reason === 'too_large' ? 'Payload too large' : 'Bad request',
      },
      { status: raw.reason === 'too_large' ? 413 : 400 },
    );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.text) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  const comment = typeof body.body === 'string' ? body.body.trim() : '';
  if (
    !projectId ||
    !taskId ||
    taskId.length > 80 ||
    !comment ||
    comment.length > 2000
  )
    return Response.json({ error: 'Invalid comment' }, { status: 400 });
  if (
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const event = await appendTaskActivity({
    projectId,
    taskId,
    source: 'user',
    kind: 'comment.created',
    ...userActivityActor(user),
    summary: `${user.name} 发表了评论`,
    body: comment,
  });
  return Response.json({ event }, { status: 201 });
}
