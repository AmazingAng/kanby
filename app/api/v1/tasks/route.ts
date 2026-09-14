import {
  authenticateAgent,
  abortIdempotentRequest,
  beginIdempotentRequest,
  canMutateTask,
  claimTask,
  completeIdempotentRequest,
  getTaskClaim,
  heartbeatTask,
  listAgentUpdates,
  publicTask,
  recordAgentUpdate,
  releaseTask,
  resolveAgentTask,
  validColumn,
} from '@/lib/agent';
import {
  AcceptanceCriteriaLimitError,
  AcceptanceCriterionRevisionConflictError,
  createAcceptanceCriterion,
  createTask,
  deleteAcceptanceCriterion,
  listTasks,
  setTaskArchived,
  splitTask,
  TaskClaimConflictError,
  TaskHierarchyError,
  TaskRevisionConflictError,
  updateAcceptanceCriterion,
  updateTask,
  type TaskRecord,
  type TaskTag,
} from '@/lib/db';
import { selectedGitHubRepository, saveGitHubTaskLink } from '@/lib/github-db';
import {
  getGitHubAppConfig,
  getGitHubLinkedItem,
  parseGitHubItemUrl,
} from '@/lib/github';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

const tags = new Set<TaskTag>(['产品', '设计', '代码', '增长']);
const checklistActions = new Set([
  'checklist.add',
  'checklist.edit',
  'checklist.check',
  'checklist.uncheck',
  'checklist.remove',
]);

function fail(code: string, message: string, status: number) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

async function agentJsonBody(request: Request) {
  if (!isJsonContentType(request))
    return {
      ok: false as const,
      response: fail(
        'json_required',
        'Content-Type must be application/json',
        415,
      ),
    };
  const parsed = await readJsonObjectWithLimit(request);
  if (!parsed.ok) {
    const tooLarge = parsed.reason === 'too_large';
    return {
      ok: false as const,
      response: fail(
        tooLarge ? 'payload_too_large' : 'invalid_json',
        tooLarge
          ? 'Request body is too large'
          : 'Request body must be a JSON object',
        tooLarge ? 413 : 400,
      ),
    };
  }
  return { ok: true as const, body: parsed.body, text: parsed.text };
}

async function authenticated(
  request: Request,
  scope: 'task:read' | 'task:write',
) {
  const identity = await authenticateAgent(request, scope);
  return (
    identity ??
    fail(
      'unauthorized',
      'Invalid, expired, or insufficiently scoped Agent Token',
      401,
    )
  );
}

async function taskByReference(
  projectId: string,
  reference: string,
  includeArchived = false,
) {
  const id = await resolveAgentTask(projectId, reference);
  if (!id) return null;
  const active = (await listTasks(projectId)).find((task) => task.id === id);
  if (active || !includeArchived) return active ?? null;
  return (
    (await listTasks(projectId, true)).find((task) => task.id === id) ?? null
  );
}

function idempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key')?.trim() ?? '';
  return value.length >= 8 && value.length <= 128 ? value : null;
}

async function idempotent(
  identity: { tokenId: string },
  request: Request,
  operation: string,
  requestBody: string,
) {
  const key = idempotencyKey(request);
  if (!key) return { kind: 'none' as const };
  return beginIdempotentRequest(identity.tokenId, key, operation, requestBody);
}

function replay(decision: Awaited<ReturnType<typeof idempotent>>) {
  if (decision.kind === 'cached')
    return Response.json(decision.response, { status: decision.status });
  if (decision.kind === 'conflict')
    return fail(
      'idempotency_conflict',
      'Idempotency key was used for another operation or payload',
      409,
    );
  if (decision.kind === 'in_progress')
    return fail(
      'idempotency_in_progress',
      'A request with this idempotency key is still in progress',
      409,
    );
  return null;
}

async function detailedTask(task: TaskRecord) {
  return {
    ...publicTask(task),
    claim: await getTaskClaim(task.id),
    updates: await listAgentUpdates(task.id),
  };
}

export async function GET(request: Request) {
  const auth = await authenticated(request, 'task:read');
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const reference = params.get('id');
  if (reference) {
    const task = await taskByReference(auth.projectId, reference);
    if (!task)
      return fail(
        'not_found',
        'Task reference was not found or is ambiguous',
        404,
      );
    return Response.json(
      { ok: true, data: await detailedTask(task) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const status = params.get('status');
  if (status && !validColumn(status))
    return fail(
      'invalid_status',
      'Status must be ideas, building, or shipped',
      400,
    );
  const tasks = (await listTasks(auth.projectId)).filter(
    (task) => !status || task.status === status,
  );
  return Response.json(
    { ok: true, data: tasks.map(publicTask) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = await authenticated(request, 'task:write');
  if (auth instanceof Response) return auth;
  const parsed = await agentJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const requestBody = parsed.text;
  const body = parsed.body;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const status = validColumn(body.status) ? body.status : 'ideas';
  if (!title || title.length > 160)
    return fail(
      'invalid_task',
      'Title is required and must be at most 160 characters',
      400,
    );
  const idempotency = await idempotent(
    auth,
    request,
    'task:create',
    requestBody,
  );
  const replayed = replay(idempotency);
  if (replayed) return replayed;
  let task = await createTask(
    {
      id: auth.userId,
      login: auth.userLogin,
      name: auth.userName,
      avatarUrl: auth.userAvatarUrl,
    },
    auth.projectId,
    { title, status },
  );
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note)
    task =
      (await updateTask(auth.projectId, {
        id: task.id,
        title: task.title,
        note: note.slice(0, 2000),
        tag: task.tag,
        ownerId: task.owner.id,
        status: task.status,
        expectedUpdatedAt: task.updatedAt,
      })) ?? task;
  await recordAgentUpdate(
    auth,
    task.id,
    'created',
    `Created task: ${task.title}`,
  );
  const response = { ok: true, data: publicTask(task) };
  if (idempotency.kind === 'acquired')
    await completeIdempotentRequest(idempotency.reservation, response, 201);
  return Response.json(response, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticated(request, 'task:write');
  if (auth instanceof Response) return auth;
  const parsed = await agentJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const requestBody = parsed.text;
  const body = parsed.body;
  const action = typeof body.action === 'string' ? body.action : 'update';
  const reference = typeof body.id === 'string' ? body.id.trim() : '';
  if (!reference)
    return fail('invalid_task', 'Task id or ref is required', 400);
  const task = await taskByReference(
    auth.projectId,
    reference,
    action === 'archive',
  );
  if (!task)
    return fail(
      'not_found',
      'Task reference was not found or is ambiguous',
      404,
    );
  if (
    (['update', 'progress', 'link', 'complete', 'split', 'archive'].includes(
      action,
    ) ||
      checklistActions.has(action)) &&
    !(await canMutateTask(auth, task.id))
  ) {
    return fail(
      'claimed_by_another_agent',
      'Task is actively claimed by another Agent Token',
      409,
    );
  }
  const idempotency = await idempotent(
    auth,
    request,
    `task:${action}`,
    requestBody,
  );
  const replayed = replay(idempotency);
  if (replayed) return replayed;
  const reject = async (code: string, message: string, status: number) => {
    if (idempotency.kind === 'acquired')
      await abortIdempotentRequest(idempotency.reservation);
    return fail(code, message, status);
  };

  let response: unknown;
  try {
    if (action === 'claim') {
      const result = await claimTask(
        auth,
        task.id,
        Number(body.leaseMinutes) || 15,
      );
      if (!result.ok) {
        return reject(
          'already_claimed',
          `Task is claimed by ${result.agentName} until ${new Date(result.leaseExpiresAt).toISOString()}`,
          409,
        );
      }
      await recordAgentUpdate(
        auth,
        task.id,
        'claimed',
        `Claimed for ${Number(body.leaseMinutes) || 15} minutes`,
      );
      response = { ok: true, data: { task: publicTask(task), claim: result } };
    } else if (action === 'heartbeat') {
      const claim = await heartbeatTask(
        auth,
        task.id,
        Number(body.leaseMinutes) || 15,
      );
      if (!claim)
        return reject(
          'not_claimed',
          'This Agent Token does not hold an active claim',
          409,
        );
      await recordAgentUpdate(
        auth,
        task.id,
        'heartbeat',
        `Heartbeat extended for ${Number(body.leaseMinutes) || 15} minutes`,
        undefined,
        true,
      );
      response = { ok: true, data: { task: publicTask(task), claim } };
    } else if (action === 'release') {
      if (!(await releaseTask(auth, task.id)))
        return reject(
          'not_claimed',
          'This Agent Token does not hold the claim',
          409,
        );
      await recordAgentUpdate(auth, task.id, 'released', 'Released task claim');
      response = { ok: true, data: publicTask(task) };
    } else if (action === 'progress') {
      const message =
        typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > 1000)
        return reject(
          'invalid_progress',
          'Progress message is required and must be at most 1000 characters',
          400,
        );
      const update = await recordAgentUpdate(
        auth,
        task.id,
        'progress',
        message,
        undefined,
        true,
      );
      if (!update)
        return reject(
          'claimed_by_another_agent',
          'Task is actively claimed by another Agent Token',
          409,
        );
      response = { ok: true, data: update };
    } else if (action === 'split') {
      const rawTitles = Array.isArray(body.titles) ? body.titles : [];
      const titles = rawTitles.map((title) =>
        typeof title === 'string' ? title.trim() : null,
      );
      if (
        titles.length < 1 ||
        titles.length > 20 ||
        titles.some((title) => !title || title.length > 160)
      )
        return reject(
          'invalid_subtasks',
          'Provide 1–20 non-empty titles of at most 160 characters',
          400,
        );
      const result = await splitTask(
        {
          id: auth.userId,
          login: auth.userLogin,
          name: auth.userName,
          avatarUrl: auth.userAvatarUrl,
        },
        auth.projectId,
        {
          parentTaskId: task.id,
          expectedUpdatedAt: task.updatedAt,
          titles: titles as string[],
        },
        {
          source: 'agent',
          actorId: auth.tokenId,
          actorName: auth.agentName,
          actorLogin: auth.userLogin,
          actorAvatarUrl: auth.userAvatarUrl,
        },
      );
      if (!result) return reject('not_found', 'Task no longer exists', 404);
      response = {
        ok: true,
        data: {
          parentUpdatedAt: result.parentUpdatedAt,
          tasks: result.tasks.map(publicTask),
        },
      };
    } else if (checklistActions.has(action)) {
      const actor = {
        source: 'agent' as const,
        actorId: auth.tokenId,
        actorName: auth.agentName,
        actorLogin: auth.userLogin,
        actorAvatarUrl: auth.userAvatarUrl,
      };
      if (action === 'checklist.add') {
        const criterionBody =
          typeof body.body === 'string' ? body.body.trim() : '';
        if (!criterionBody || criterionBody.length > 240)
          return reject(
            'invalid_criterion',
            'Acceptance criterion is required and must be at most 240 characters',
            400,
          );
        const result = await createAcceptanceCriterion(
          auth.projectId,
          task.id,
          criterionBody,
          task.updatedAt,
          actor,
        );
        if (!result) return reject('not_found', 'Task no longer exists', 404);
        response = { ok: true, data: result };
      } else {
        const criterionId =
          typeof body.criterionId === 'string' ? body.criterionId.trim() : '';
        const criterion = task.acceptanceCriteria.find(
          (item) => item.id === criterionId,
        );
        if (!criterion)
          return reject(
            'criterion_not_found',
            'Acceptance criterion was not found on this task',
            404,
          );
        if (action === 'checklist.remove') {
          const result = await deleteAcceptanceCriterion(
            auth.projectId,
            task.id,
            {
              id: criterion.id,
              expectedUpdatedAt: criterion.updatedAt,
              expectedTaskUpdatedAt: task.updatedAt,
            },
            actor,
          );
          if (!result)
            return reject(
              'criterion_not_found',
              'Acceptance criterion no longer exists',
              404,
            );
          response = { ok: true, data: result };
        } else {
          const criterionBody =
            action === 'checklist.edit' && typeof body.body === 'string'
              ? body.body.trim()
              : undefined;
          if (
            action === 'checklist.edit' &&
            (!criterionBody || criterionBody.length > 240)
          )
            return reject(
              'invalid_criterion',
              'Acceptance criterion is required and must be at most 240 characters',
              400,
            );
          const result = await updateAcceptanceCriterion(
            auth.projectId,
            task.id,
            {
              id: criterion.id,
              body: criterionBody,
              completed:
                action === 'checklist.check'
                  ? true
                  : action === 'checklist.uncheck'
                    ? false
                    : undefined,
              expectedUpdatedAt: criterion.updatedAt,
              expectedTaskUpdatedAt: task.updatedAt,
            },
            actor,
          );
          if (!result)
            return reject(
              'criterion_not_found',
              'Acceptance criterion no longer exists',
              404,
            );
          response = { ok: true, data: result };
        }
      }
    } else if (action === 'complete') {
      const updated = await updateTask(auth.projectId, {
        ...task,
        id: task.id,
        ownerId: task.owner.id,
        ownerIds: task.owners.map((owner) => owner.id),
        status: 'shipped',
        expectedUpdatedAt: task.updatedAt,
        agentTokenId: auth.tokenId,
      });
      if (!updated) return reject('not_found', 'Task no longer exists', 404);
      await releaseTask(auth, task.id);
      await recordAgentUpdate(
        auth,
        task.id,
        'completed',
        typeof body.message === 'string' && body.message.trim()
          ? body.message.trim().slice(0, 1000)
          : 'Completed task',
      );
      response = { ok: true, data: publicTask(updated) };
    } else if (action === 'archive') {
      const archived = await setTaskArchived(
        auth.projectId,
        task.id,
        true,
        task.updatedAt,
        {
          source: 'agent',
          actorId: auth.tokenId,
          actorName: auth.agentName,
          actorLogin: auth.userLogin,
          actorAvatarUrl: auth.userAvatarUrl,
        },
      );
      if (!archived) return reject('not_found', 'Task no longer exists', 404);
      response = { ok: true, data: publicTask(archived) };
    } else if (action === 'link') {
      const url = typeof body.url === 'string' ? body.url : '';
      const parsed = parseGitHubItemUrl(url);
      const config = getGitHubAppConfig();
      if (!parsed || !config)
        return reject(
          'invalid_github_link',
          'A GitHub issue or pull request URL is required',
          400,
        );
      const repository = await selectedGitHubRepository(
        auth.projectId,
        parsed.fullName,
      );
      if (!repository)
        return reject(
          'repository_not_allowed',
          'Repository is not selected for this Kanby project',
          403,
        );
      const item = await getGitHubLinkedItem(
        config,
        repository.installation_id,
        parsed.fullName,
        parsed.kind,
        parsed.number,
      );
      const link = await saveGitHubTaskLink(
        auth.projectId,
        task.id,
        repository.id,
        item,
        auth.tokenId,
      );
      if (!link)
        return reject(
          'claimed_by_another_agent',
          'Task is actively claimed by another Agent Token',
          409,
        );
      await recordAgentUpdate(
        auth,
        task.id,
        'linked',
        `Linked ${parsed.fullName}#${parsed.number}`,
        { url: item.url },
      );
      response = { ok: true, data: link };
    } else if (action === 'update') {
      const title =
        typeof body.title === 'string' ? body.title.trim() : task.title;
      const note = typeof body.note === 'string' ? body.note.trim() : task.note;
      const due = typeof body.due === 'string' ? body.due.trim() : task.due;
      const status =
        body.status === undefined
          ? task.status
          : validColumn(body.status)
            ? body.status
            : null;
      const tag =
        body.tag === undefined
          ? task.tag
          : typeof body.tag === 'string' && tags.has(body.tag as TaskTag)
            ? (body.tag as TaskTag)
            : null;
      const legacyOwnerId =
        typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
      const ownerIds = Array.isArray(body.ownerIds)
        ? body.ownerIds.map((ownerId) =>
            typeof ownerId === 'string' ? ownerId.trim() : '',
          )
        : legacyOwnerId
          ? [legacyOwnerId]
          : task.owners.map((owner) => owner.id);
      const ownerId = ownerIds[0] ?? '';
      if (
        !title ||
        title.length > 160 ||
        note.length > 2000 ||
        (due?.length ?? 0) > 40 ||
        ownerIds.length < 1 ||
        ownerIds.length > 3 ||
        ownerIds.some((candidate) => !candidate || candidate.length > 80) ||
        new Set(ownerIds).size !== ownerIds.length ||
        !status ||
        !tag
      )
        return reject('invalid_task', 'Invalid task fields', 400);
      const updated = await updateTask(auth.projectId, {
        id: task.id,
        title,
        note,
        due,
        ownerId,
        ownerIds,
        status,
        tag,
        expectedUpdatedAt: task.updatedAt,
        agentTokenId: auth.tokenId,
      });
      if (!updated)
        return reject('invalid_owner', 'Task or assignee was not found', 404);
      await recordAgentUpdate(auth, task.id, 'updated', 'Updated task fields');
      response = { ok: true, data: publicTask(updated) };
    } else {
      return reject(
        'invalid_action',
        'Action must be update, split, claim, heartbeat, progress, release, link, complete, archive, or checklist.*',
        400,
      );
    }
  } catch (error) {
    if (
      error instanceof TaskRevisionConflictError ||
      error instanceof AcceptanceCriterionRevisionConflictError ||
      error instanceof AcceptanceCriteriaLimitError ||
      error instanceof TaskClaimConflictError ||
      error instanceof TaskHierarchyError
    ) {
      if (idempotency.kind === 'acquired')
        await abortIdempotentRequest(idempotency.reservation);
      return fail(
        error instanceof TaskClaimConflictError
          ? 'claimed_by_another_agent'
          : error instanceof AcceptanceCriteriaLimitError
            ? 'acceptance_limit'
            : error instanceof TaskHierarchyError
              ? 'invalid_hierarchy'
              : 'task_conflict',
        error.message,
        409,
      );
    }
    throw error;
  }
  if (idempotency.kind === 'acquired')
    await completeIdempotentRequest(idempotency.reservation, response);
  return Response.json(response);
}
