import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  createTask,
  getProjectRole,
  listTasks,
  permanentlyDeleteArchivedTask,
  reorderTasks,
  setTaskArchived,
  TaskRevisionConflictError,
  updateTask,
  type ColumnId,
  type TaskTag,
} from '@/lib/db';
import { attachmentStorage } from '@/lib/storage';
import { userActivityActor } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

const statuses = new Set<ColumnId>(['ideas', 'building', 'shipped']);
const tags = new Set<TaskTag>(['产品', '设计', '代码', '增长']);

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    {
      tasks: await listTasks(
        projectId,
        new URL(request.url).searchParams.get('archived') === '1',
      ),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as {
    projectId?: unknown;
    title?: unknown;
    status?: unknown;
  };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const status =
    typeof body.status === 'string' && statuses.has(body.status as ColumnId)
      ? (body.status as ColumnId)
      : null;
  if (!title || title.length > 160 || !status || !projectId)
    return Response.json({ error: 'Invalid task' }, { status: 400 });
  if (!(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    {
      task: await createTask(
        user,
        projectId,
        { title, status },
        userActivityActor(user),
      ),
    },
    { status: 201 },
  );
}

export async function PUT(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as Record<string, unknown>;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const id = typeof body.id === 'string' ? body.id : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const due = typeof body.due === 'string' ? body.due.trim() : '';
  const legacyOwnerId =
    typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
  const ownerIds = Array.isArray(body.ownerIds)
    ? body.ownerIds.map((ownerId) =>
        typeof ownerId === 'string' ? ownerId.trim() : '',
      )
    : legacyOwnerId
      ? [legacyOwnerId]
      : [];
  const ownerId = ownerIds[0] ?? '';
  const expectedUpdatedAt = Number(body.updatedAt);
  const editSessionId =
    typeof body.editSessionId === 'string' &&
    /^[A-Za-z0-9_-]{8,100}$/.test(body.editSessionId)
      ? body.editSessionId
      : undefined;
  const status =
    typeof body.status === 'string' && statuses.has(body.status as ColumnId)
      ? (body.status as ColumnId)
      : null;
  const tag =
    typeof body.tag === 'string' && tags.has(body.tag as TaskTag)
      ? (body.tag as TaskTag)
      : null;
  if (
    !projectId ||
    !id ||
    id.length > 80 ||
    !title ||
    title.length > 160 ||
    note.length > 2000 ||
    due.length > 40 ||
    ownerIds.length < 1 ||
    ownerIds.length > 3 ||
    ownerIds.some((candidate) => !candidate || candidate.length > 80) ||
    new Set(ownerIds).size !== ownerIds.length ||
    !status ||
    !tag ||
    !Number.isSafeInteger(expectedUpdatedAt) ||
    expectedUpdatedAt < 1
  ) {
    return Response.json({ error: 'Invalid task' }, { status: 400 });
  }
  if (!(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  let task;
  try {
    task = await updateTask(projectId, {
      id,
      title,
      note,
      due: due || undefined,
      ownerId,
      ownerIds,
      status,
      tag,
      expectedUpdatedAt,
      activity: {
        actor: userActivityActor(user),
        editSessionId,
      },
    });
  } catch (error) {
    if (error instanceof TaskRevisionConflictError) {
      return Response.json(
        {
          error: 'Task changed elsewhere',
          currentUpdatedAt: error.currentUpdatedAt,
        },
        { status: 409 },
      );
    }
    throw error;
  }
  if (!task)
    return Response.json({ error: 'Task or owner not found' }, { status: 404 });
  return Response.json({ task });
}

export async function PATCH(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as Record<string, unknown>;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (body.action === 'archive' || body.action === 'restore') {
    const id = typeof body.id === 'string' ? body.id : '';
    const expectedUpdatedAt = Number(body.updatedAt);
    if (
      !id ||
      id.length > 80 ||
      !Number.isSafeInteger(expectedUpdatedAt) ||
      expectedUpdatedAt < 1
    ) {
      return Response.json(
        { error: 'Invalid lifecycle request' },
        { status: 400 },
      );
    }
    try {
      const task = await setTaskArchived(
        projectId,
        id,
        body.action === 'archive',
        expectedUpdatedAt,
        userActivityActor(user),
      );
      if (!task)
        return Response.json({ error: 'Task not found' }, { status: 404 });
      return Response.json({ task });
    } catch (error) {
      if (error instanceof TaskRevisionConflictError) {
        return Response.json(
          {
            error: 'Task changed elsewhere',
            currentUpdatedAt: error.currentUpdatedAt,
          },
          { status: 409 },
        );
      }
      throw error;
    }
  }
  if (!Array.isArray(body.items) || body.items.length > 500)
    return Response.json({ error: 'Invalid order' }, { status: 400 });
  const items = body.items.map((item) => {
    const value = item as {
      id?: unknown;
      status?: unknown;
      position?: unknown;
    };
    if (
      typeof value.id !== 'string' ||
      value.id.length > 80 ||
      typeof value.status !== 'string' ||
      !statuses.has(value.status as ColumnId) ||
      !Number.isInteger(value.position) ||
      Number(value.position) < 0
    )
      return null;
    return {
      id: value.id,
      status: value.status as ColumnId,
      position: Number(value.position),
    };
  });
  if (items.some((item) => item === null))
    return Response.json({ error: 'Invalid order' }, { status: 400 });
  await reorderTasks(
    projectId,
    items as { id: string; status: ColumnId; position: number }[],
    typeof body.movedTaskId === 'string' && body.movedTaskId.length <= 80
      ? {
          movedTaskId: body.movedTaskId,
          actor: userActivityActor(user),
        }
      : undefined,
  );
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as Record<string, unknown>;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const id = typeof body.id === 'string' ? body.id : '';
  const expectedUpdatedAt = Number(body.updatedAt);
  if (
    !projectId ||
    !id ||
    id.length > 80 ||
    !Number.isSafeInteger(expectedUpdatedAt) ||
    expectedUpdatedAt < 1
  ) {
    return Response.json({ error: 'Invalid delete request' }, { status: 400 });
  }
  if ((await getProjectRole(projectId, user.id)) !== 'owner')
    return Response.json(
      { error: 'Owner permission required' },
      { status: 403 },
    );
  try {
    const directChildren = [
      ...(await listTasks(projectId)),
      ...(await listTasks(projectId, true)),
    ].filter((task) => task.parent?.id === id);
    const objectKeys = await permanentlyDeleteArchivedTask(
      projectId,
      id,
      expectedUpdatedAt,
    );
    if (!objectKeys)
      return Response.json(
        { error: 'Archived task not found' },
        { status: 404 },
      );
    const bucket = attachmentStorage();
    const cleanup = await Promise.allSettled(
      objectKeys.map((objectKey) => bucket.delete(objectKey)),
    );
    const promotedIds = new Set(directChildren.map((task) => task.id));
    const promotedTasks = promotedIds.size
      ? [
          ...(await listTasks(projectId)),
          ...(await listTasks(projectId, true)),
        ].filter((task) => promotedIds.has(task.id))
      : [];
    return Response.json({
      ok: true,
      cleanupPending: cleanup.some((result) => result.status === 'rejected'),
      ...(promotedTasks.length > 0 ? { promotedTasks } : {}),
    });
  } catch (error) {
    if (error instanceof TaskRevisionConflictError) {
      return Response.json(
        {
          error: 'Task changed elsewhere',
          currentUpdatedAt: error.currentUpdatedAt,
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
