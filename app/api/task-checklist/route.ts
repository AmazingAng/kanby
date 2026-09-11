import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  AcceptanceCriteriaLimitError,
  AcceptanceCriterionRevisionConflictError,
  createAcceptanceCriterion,
  deleteAcceptanceCriterion,
  getProjectRole,
  TaskRevisionConflictError,
  updateAcceptanceCriterion,
} from '@/lib/db';
import { readTextBodyWithLimit } from '@/lib/request-limits';
import { userActivityActor } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BODY = 8 * 1024;

async function authorizedJsonBody(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return {
      ok: false as const,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    };
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return {
      ok: false as const,
      response: Response.json({ error: 'JSON required' }, { status: 415 }),
    };
  const raw = await readTextBodyWithLimit(request, MAX_REQUEST_BODY);
  if (!raw.ok)
    return {
      ok: false as const,
      response: Response.json(
        {
          error:
            raw.reason === 'too_large' ? 'Payload too large' : 'Bad request',
        },
        { status: raw.reason === 'too_large' ? 413 : 400 },
      ),
    };
  try {
    const body = JSON.parse(raw.text) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('invalid');
    return { ok: true as const, user, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false as const,
      response: Response.json({ error: 'Invalid JSON' }, { status: 400 }),
    };
  }
}

function identity(body: Record<string, unknown>) {
  return {
    projectId: typeof body.projectId === 'string' ? body.projectId : '',
    taskId: typeof body.taskId === 'string' ? body.taskId : '',
    taskUpdatedAt: Number(body.taskUpdatedAt),
  };
}

function validIdentity(value: ReturnType<typeof identity>) {
  return (
    Boolean(value.projectId) &&
    Boolean(value.taskId) &&
    value.projectId.length <= 80 &&
    value.taskId.length <= 80 &&
    Number.isSafeInteger(value.taskUpdatedAt) &&
    value.taskUpdatedAt > 0
  );
}

function hasOnlyKeys(body: Record<string, unknown>, allowed: string[]) {
  const keys = new Set(allowed);
  return Object.keys(body).every((key) => keys.has(key));
}

function conflictResponse(error: unknown) {
  if (error instanceof AcceptanceCriterionRevisionConflictError)
    return Response.json(
      {
        error: 'Acceptance criterion changed elsewhere',
        currentUpdatedAt: error.currentUpdatedAt,
        currentTaskUpdatedAt: error.currentTaskUpdatedAt,
      },
      { status: 409 },
    );
  if (error instanceof TaskRevisionConflictError)
    return Response.json(
      {
        error: 'Task changed elsewhere',
        currentTaskUpdatedAt: error.currentUpdatedAt,
      },
      { status: 409 },
    );
  if (error instanceof AcceptanceCriteriaLimitError)
    return Response.json(
      { error: 'A task can have at most 20 acceptance criteria' },
      { status: 409 },
    );
  throw error;
}

export async function POST(request: Request) {
  const parsed = await authorizedJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const ids = identity(parsed.body);
  const body =
    typeof parsed.body.body === 'string' ? parsed.body.body.trim() : '';
  if (
    !validIdentity(ids) ||
    !hasOnlyKeys(parsed.body, [
      'projectId',
      'taskId',
      'body',
      'taskUpdatedAt',
    ]) ||
    !body ||
    body.length > 240
  )
    return Response.json(
      { error: 'Invalid acceptance criterion' },
      { status: 400 },
    );
  if (!(await getProjectRole(ids.projectId, parsed.user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const result = await createAcceptanceCriterion(
      ids.projectId,
      ids.taskId,
      body,
      ids.taskUpdatedAt,
      userActivityActor(parsed.user),
    );
    if (!result)
      return Response.json({ error: 'Task not found' }, { status: 404 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return conflictResponse(error);
  }
}

export async function PATCH(request: Request) {
  const parsed = await authorizedJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const ids = identity(parsed.body);
  const id = typeof parsed.body.id === 'string' ? parsed.body.id : '';
  const updatedAt = Number(parsed.body.updatedAt);
  const hasBody = Object.prototype.hasOwnProperty.call(parsed.body, 'body');
  const hasCompleted = Object.prototype.hasOwnProperty.call(
    parsed.body,
    'completed',
  );
  const body =
    hasBody && typeof parsed.body.body === 'string'
      ? parsed.body.body.trim()
      : undefined;
  const completed =
    hasCompleted && typeof parsed.body.completed === 'boolean'
      ? parsed.body.completed
      : undefined;
  if (
    !validIdentity(ids) ||
    !hasOnlyKeys(parsed.body, [
      'projectId',
      'taskId',
      'id',
      'body',
      'completed',
      'updatedAt',
      'taskUpdatedAt',
    ]) ||
    !id ||
    id.length > 80 ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 1 ||
    (!hasBody && !hasCompleted) ||
    (hasBody && (!body || body.length > 240)) ||
    (hasCompleted && completed === undefined)
  )
    return Response.json(
      { error: 'Invalid acceptance update' },
      { status: 400 },
    );
  if (!(await getProjectRole(ids.projectId, parsed.user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const result = await updateAcceptanceCriterion(
      ids.projectId,
      ids.taskId,
      {
        id,
        body,
        completed,
        expectedUpdatedAt: updatedAt,
        expectedTaskUpdatedAt: ids.taskUpdatedAt,
      },
      userActivityActor(parsed.user),
    );
    if (!result)
      return Response.json(
        { error: 'Acceptance criterion not found' },
        { status: 404 },
      );
    return Response.json(result);
  } catch (error) {
    return conflictResponse(error);
  }
}

export async function DELETE(request: Request) {
  const parsed = await authorizedJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const ids = identity(parsed.body);
  const id = typeof parsed.body.id === 'string' ? parsed.body.id : '';
  const updatedAt = Number(parsed.body.updatedAt);
  if (
    !validIdentity(ids) ||
    !hasOnlyKeys(parsed.body, [
      'projectId',
      'taskId',
      'id',
      'updatedAt',
      'taskUpdatedAt',
    ]) ||
    !id ||
    id.length > 80 ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 1
  )
    return Response.json(
      { error: 'Invalid acceptance deletion' },
      { status: 400 },
    );
  if (!(await getProjectRole(ids.projectId, parsed.user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const result = await deleteAcceptanceCriterion(
      ids.projectId,
      ids.taskId,
      {
        id,
        expectedUpdatedAt: updatedAt,
        expectedTaskUpdatedAt: ids.taskUpdatedAt,
      },
      userActivityActor(parsed.user),
    );
    if (!result)
      return Response.json(
        { error: 'Acceptance criterion not found' },
        { status: 404 },
      );
    return Response.json(result);
  } catch (error) {
    return conflictResponse(error);
  }
}
