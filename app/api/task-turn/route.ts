import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole, taskBelongsToProject } from '@/lib/db';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';
import {
  isTurnReason,
  MAX_TURN_NOTE_LENGTH,
  setTaskTurn,
  TurnTaskNotFoundError,
  userCollabActor,
  type TurnTarget,
} from '@/lib/turns';

export const dynamic = 'force-dynamic';

function parseTarget(value: unknown): TurnTarget | null | 'invalid' {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'invalid';
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const userId = typeof record.userId === 'string' ? record.userId.trim() : '';
  const tokenId =
    typeof record.tokenId === 'string' && record.tokenId.trim()
      ? record.tokenId.trim()
      : null;
  if (
    (kind !== 'member' && kind !== 'agent') ||
    !userId ||
    userId.length > 80 ||
    (tokenId && (kind !== 'agent' || tokenId.length > 80))
  )
    return 'invalid';
  return { kind, userId, tokenId };
}

/** Set, hand off or clear whose turn a task is. */
export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!isJsonContentType(request))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const parsed = await readJsonObjectWithLimit(request, 16 * 1024);
  if (!parsed.ok)
    return Response.json(
      {
        error:
          parsed.reason === 'too_large' ? 'Payload too large' : 'Invalid JSON',
      },
      { status: parsed.reason === 'too_large' ? 413 : 400 },
    );
  const body = parsed.body;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  const target = parseTarget(body.to);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (
    !projectId ||
    !taskId ||
    taskId.length > 80 ||
    target === 'invalid' ||
    (target && !isTurnReason(body.reason)) ||
    (body.note !== undefined &&
      body.note !== null &&
      typeof body.note !== 'string') ||
    note.length > MAX_TURN_NOTE_LENGTH
  )
    return Response.json({ error: 'Invalid turn' }, { status: 400 });
  if (
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const result = await setTaskTurn({
      projectId,
      taskId,
      target,
      reason: target && isTurnReason(body.reason) ? body.reason : null,
      note: note || null,
      actor: userCollabActor(user),
    });
    if (!result)
      return Response.json(
        { error: 'Target is not a project member or agent' },
        { status: 400 },
      );
    return Response.json({ turn: result.turn, rejected: result.rejected });
  } catch (error) {
    if (error instanceof TurnTaskNotFoundError)
      return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
