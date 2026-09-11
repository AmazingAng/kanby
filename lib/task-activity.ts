import type { AuthUser } from '@/lib/auth';
import { database, ensureSchema } from '@/lib/db';

export type TaskActivitySource = 'user' | 'agent' | 'github' | 'system';

export type TaskActivityEvent = {
  id: string;
  taskId: string;
  source: TaskActivitySource;
  kind: string;
  actor: {
    id: string | null;
    name: string;
    login: string | null;
    avatarUrl: string | null;
  };
  summary: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
};

export type TaskActivityInput = {
  id?: string;
  projectId: string;
  taskId: string;
  source: TaskActivitySource;
  kind: string;
  actorId?: string | null;
  actorName: string;
  actorLogin?: string | null;
  actorAvatarUrl?: string | null;
  summary: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
  createdAt?: number;
};

export type TaskAgentState = {
  taskId: string;
  agentName: string;
  leaseExpiresAt: number;
  lastHeartbeatAt: number;
  latestProgress: string | null;
  latestProgressAt: number | null;
};

type TaskActivityRow = {
  id: string;
  task_id: string;
  source: TaskActivitySource;
  kind: string;
  actor_id: string | null;
  actor_name: string;
  actor_login: string | null;
  actor_avatar_url: string | null;
  summary: string;
  body: string | null;
  metadata: string | null;
  created_at: number;
};

type StoredTaskActivityInput = Required<
  Pick<
    TaskActivityInput,
    | 'id'
    | 'projectId'
    | 'taskId'
    | 'source'
    | 'kind'
    | 'actorName'
    | 'summary'
    | 'createdAt'
  >
> & {
  actorId: string | null;
  actorLogin: string | null;
  actorAvatarUrl: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  dedupeKey: string | null;
};

function storedInput(input: TaskActivityInput): StoredTaskActivityInput {
  return {
    id: input.id ?? crypto.randomUUID(),
    projectId: input.projectId,
    taskId: input.taskId,
    source: input.source,
    kind: input.kind,
    actorId: input.actorId ?? null,
    actorName: input.actorName.slice(0, 120),
    actorLogin: input.actorLogin ?? null,
    actorAvatarUrl: input.actorAvatarUrl ?? null,
    summary: input.summary.slice(0, 240),
    body: input.body?.slice(0, 2000) ?? null,
    metadata: input.metadata ?? null,
    dedupeKey: input.dedupeKey?.slice(0, 240) ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
}

function mapTaskActivity(row: TaskActivityRow): TaskActivityEvent {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    taskId: row.task_id,
    source: row.source,
    kind: row.kind,
    actor: {
      id: row.actor_id,
      name: row.actor_name,
      login: row.actor_login,
      avatarUrl: row.actor_avatar_url,
    },
    summary: row.summary,
    body: row.body,
    metadata,
    createdAt: Number(row.created_at),
  };
}

export function userActivityActor(user: AuthUser) {
  return {
    actorId: user.id,
    actorName: user.name,
    actorLogin: user.login,
    actorAvatarUrl: user.avatarUrl,
  };
}

export function prepareTaskActivityStatement(
  db: D1Database,
  rawInput: TaskActivityInput,
  options?: {
    onlyIfTaskUpdatedAt?: number;
    onlyIfTaskAssigneeRevision?: string;
    onlyIfAgentUpdateId?: string;
  },
) {
  const input = storedInput(rawInput);
  const expectedTaskUpdatedAt = options?.onlyIfTaskUpdatedAt ?? null;
  const expectedTaskAssigneeRevision =
    options?.onlyIfTaskAssigneeRevision ?? null;
  const requiredAgentUpdateId = options?.onlyIfAgentUpdateId ?? null;
  return db
    .prepare(
      `INSERT INTO task_events
       (id, project_id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, dedupe_key, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (? IS NULL OR EXISTS (
           SELECT 1 FROM tasks
           WHERE id = ? AND project_id = ? AND updated_at = ?
         ))
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM tasks
           WHERE id = ? AND project_id = ? AND assignee_revision = ?
         ))
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM task_agent_updates
           WHERE id = ? AND task_id = ? AND project_id = ?
         ))
       ON CONFLICT(project_id, dedupe_key) DO UPDATE SET
         source = excluded.source,
         kind = excluded.kind,
         actor_id = excluded.actor_id,
         actor_name = excluded.actor_name,
         actor_login = excluded.actor_login,
         actor_avatar_url = excluded.actor_avatar_url,
         summary = excluded.summary,
         body = excluded.body,
         metadata = excluded.metadata,
         created_at = excluded.created_at`,
    )
    .bind(
      input.id,
      input.projectId,
      input.taskId,
      input.source,
      input.kind,
      input.actorId,
      input.actorName,
      input.actorLogin,
      input.actorAvatarUrl,
      input.summary,
      input.body,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.dedupeKey,
      input.createdAt,
      expectedTaskUpdatedAt,
      input.taskId,
      input.projectId,
      expectedTaskUpdatedAt,
      expectedTaskAssigneeRevision,
      input.taskId,
      input.projectId,
      expectedTaskAssigneeRevision,
      requiredAgentUpdateId,
      requiredAgentUpdateId,
      input.taskId,
      input.projectId,
    );
}

export async function appendTaskActivity(input: TaskActivityInput) {
  await ensureSchema();
  const db = database();
  const stored = storedInput(input);
  await prepareTaskActivityStatement(db, stored).run();
  const row = stored.dedupeKey
    ? await db
        .prepare(
          `SELECT id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, created_at
           FROM task_events WHERE project_id = ? AND dedupe_key = ?`,
        )
        .bind(stored.projectId, stored.dedupeKey)
        .first<TaskActivityRow>()
    : await db
        .prepare(
          `SELECT id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, created_at
           FROM task_events WHERE id = ? AND project_id = ?`,
        )
        .bind(stored.id, stored.projectId)
        .first<TaskActivityRow>();
  if (!row) throw new Error('Task activity insert failed');
  return mapTaskActivity(row);
}

function parseCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const separator = cursor.indexOf(':');
  const createdAt = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (
    separator < 1 ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !id ||
    id.length > 120
  )
    throw new Error('Invalid activity cursor');
  return { createdAt, id };
}

export async function listTaskActivity(input: {
  projectId: string;
  taskId: string;
  cursor?: string | null;
  limit?: number;
}) {
  await ensureSchema();
  const cursor = parseCursor(input.cursor);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const query = `SELECT id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, created_at
     FROM task_events
     WHERE project_id = ? AND task_id = ?
       ${cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
     ORDER BY created_at DESC, id DESC LIMIT ?`;
  const result = cursor
    ? await database()
        .prepare(query)
        .bind(
          input.projectId,
          input.taskId,
          cursor.createdAt,
          cursor.createdAt,
          cursor.id,
          limit + 1,
        )
        .all<TaskActivityRow>()
    : await database()
        .prepare(query)
        .bind(input.projectId, input.taskId, limit + 1)
        .all<TaskActivityRow>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  return {
    events: rows.map(mapTaskActivity),
    nextCursor:
      result.results.length > limit && last
        ? `${Number(last.created_at)}:${last.id}`
        : null,
  };
}

export async function listProjectAgentStates(
  projectId: string,
): Promise<TaskAgentState[]> {
  await ensureSchema();
  const now = Date.now();
  const result = await database()
    .prepare(
      `SELECT c.task_id, c.agent_name, c.lease_expires_at, c.updated_at,
        e.body AS latest_progress, e.created_at AS latest_progress_at
       FROM task_agent_claims c
       LEFT JOIN task_events e ON e.id = (
         SELECT recent.id FROM task_events recent
         WHERE recent.project_id = c.project_id
           AND recent.task_id = c.task_id
           AND recent.kind = 'agent.progress'
           AND recent.created_at >= c.created_at
         ORDER BY recent.created_at DESC, recent.id DESC LIMIT 1
       )
       WHERE c.project_id = ? AND c.lease_expires_at > ?
       ORDER BY c.updated_at DESC`,
    )
    .bind(projectId, now)
    .all<{
      task_id: string;
      agent_name: string;
      lease_expires_at: number;
      updated_at: number;
      latest_progress: string | null;
      latest_progress_at: number | null;
    }>();
  return result.results.map((row) => ({
    taskId: row.task_id,
    agentName: row.agent_name,
    leaseExpiresAt: Number(row.lease_expires_at),
    lastHeartbeatAt: Number(row.updated_at),
    latestProgress: row.latest_progress,
    latestProgressAt:
      row.latest_progress_at == null ? null : Number(row.latest_progress_at),
  }));
}
