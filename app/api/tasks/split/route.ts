import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  getProjectRole,
  splitTask,
  TaskHierarchyError,
  TaskRevisionConflictError,
} from '@/lib/db';
import { readTextBodyWithLimit } from '@/lib/request-limits';
import { userActivityActor } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

const MAX_SPLIT_BODY = 16 * 1024;

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });

  const requestBody = await readTextBodyWithLimit(request, MAX_SPLIT_BODY);
  if (!requestBody.ok)
    return Response.json(
      { error: 'Invalid split request' },
      { status: requestBody.reason === 'too_large' ? 413 : 400 },
    );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(requestBody.text) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const parentTaskId =
    typeof body.parentTaskId === 'string' ? body.parentTaskId : '';
  const expectedUpdatedAt = Number(body.parentUpdatedAt);
  const rawTitles = Array.isArray(body.titles) ? body.titles : [];
  const titles = rawTitles.map((title) =>
    typeof title === 'string' ? title.trim() : null,
  );
  if (
    !projectId ||
    !parentTaskId ||
    parentTaskId.length > 80 ||
    !Number.isSafeInteger(expectedUpdatedAt) ||
    expectedUpdatedAt < 1 ||
    titles.length < 1 ||
    titles.length > 20 ||
    titles.some((title) => !title || title.length > 160)
  )
    return Response.json({ error: 'Invalid split request' }, { status: 400 });
  if (!(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const result = await splitTask(
      user,
      projectId,
      {
        parentTaskId,
        expectedUpdatedAt,
        titles: titles as string[],
      },
      userActivityActor(user),
    );
    if (!result)
      return Response.json({ error: 'Parent task not found' }, { status: 404 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TaskRevisionConflictError)
      return Response.json(
        {
          error: 'Parent task changed elsewhere',
          currentUpdatedAt: error.currentUpdatedAt,
        },
        { status: 409 },
      );
    if (error instanceof TaskHierarchyError)
      return Response.json(
        { error: 'A subtask cannot be split again' },
        { status: 409 },
      );
    throw error;
  }
}
