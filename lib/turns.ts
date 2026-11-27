import type { AuthUser } from '@/lib/auth';
import { database, ensureSchema } from '@/lib/db';
import {
  agentLabel,
  mapTurn,
  MAX_TURN_NOTE_LENGTH,
  TURN_REASON_LABELS,
  TURN_ROW_COLUMNS,
  TURN_ROW_JOINS,
  type TaskTurn,
  type TurnReason,
  type TurnRow,
  type TurnTarget,
} from '@/lib/task-turn';

export * from '@/lib/task-turn';
import {
  notifyTaskEvent,
  type NotificationEventKind,
} from '@/lib/notifications';
import { recoverySnapshot } from '@/lib/recovery';
import {
  prepareTaskActivityStatement,
  type TaskActivityEvent,
} from '@/lib/task-activity';

/** Actor of a collaboration write: a member, or one of a member's agents. */
export type CollabActor = {
  source: 'user' | 'agent';
  userId: string;
  userLogin: string;
  userName: string;
  avatarUrl: string | null;
  tokenId: string | null;
  agentName: string | null;
};

export function actorDisplayName(actor: CollabActor) {
  return actor.source === 'agent' && actor.agentName
    ? agentLabel(actor.userName, actor.agentName)
    : actor.userName;
}

export function userCollabActor(user: AuthUser): CollabActor {
  return {
    source: 'user',
    userId: user.id,
    userLogin: user.login,
    userName: user.name,
    avatarUrl: user.avatarUrl,
    tokenId: null,
    agentName: null,
  };
}

export function agentCollabActor(identity: {
  tokenId: string;
  userId: string;
  userLogin: string;
  userName: string;
  userAvatarUrl: string | null;
  agentName: string;
}): CollabActor {
  return {
    source: 'agent',
    userId: identity.userId,
    userLogin: identity.userLogin,
    userName: identity.userName,
    avatarUrl: identity.userAvatarUrl,
    tokenId: identity.tokenId,
    agentName: identity.agentName,
  };
}

function activityActor(actor: CollabActor) {
  return {
    source: actor.source,
    actorId: actor.tokenId ?? actor.userId,
    actorName: actor.agentName ?? actor.userName,
    actorLogin: actor.userLogin,
    actorAvatarUrl: actor.avatarUrl,
  };
}

// --- Thread visibility -------------------------------------------------------

const CONVERSATION_KINDS = [
  'comment.created',
  'turn.changed',
  'turn.rejected',
  'agent.progress',
  'agent.completed',
  'task.created',
  'task.moved',
  'task.split',
  'acceptance.completed',
  'acceptance.reopened',
  'github.pull_request.closed',
  'github.issues.closed',
] as const;
const conversationKinds = new Set<string>(CONVERSATION_KINDS);

/** Human-facing thread entries vs. bookkeeping records (heartbeats, CI…). */
export function activityVisibility(kind: string): 'conversation' | 'record' {
  return conversationKinds.has(kind) ? 'conversation' : 'record';
}

const conversationPlaceholders = CONVERSATION_KINDS.map(() => '?').join(', ');

// --- Target and mention parsing ---------------------------------------------

const LOGIN = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const AGENT = '[^\\s@,，。;；:：!?！？()（）]{1,48}';
const TARGET_PATTERN = new RegExp(`^@?(${LOGIN})(?:/(${AGENT}))?$`);
const MENTION_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_@/])@(${LOGIN})(?:/(${AGENT}))?`,
  'g',
);

export type ParsedTarget = { login: string; agent: string | null };

export function parseTargetSpec(value: string): ParsedTarget | null {
  const match = TARGET_PATTERN.exec(value.trim());
  return match ? { login: match[1]!, agent: match[2] ?? null } : null;
}

export function parseMentions(body: string): ParsedTarget[] {
  const seen = new Set<string>();
  const mentions: ParsedTarget[] = [];
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const login = match[2]!;
    const agent = match[3] ?? null;
    const key = `${login.toLowerCase()}/${agent?.toLowerCase() ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ login, agent });
    if (mentions.length >= 10) break;
  }
  return mentions;
}

export type ResolvedTarget = TurnTarget & {
  login: string;
  name: string;
  agentName: string | null;
};

/** Resolve `login` or `login/agent|<token name>` against project members. */
export async function resolveTarget(
  projectId: string,
  parsed: ParsedTarget,
): Promise<ResolvedTarget | null> {
  await ensureSchema();
  const db = database();
  const member = await db
    .prepare(
      `SELECT u.id, u.login, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND lower(u.login) = lower(?) LIMIT 1`,
    )
    .bind(projectId, parsed.login)
    .first<{ id: string; login: string; name: string }>();
  if (!member) return null;
  if (!parsed.agent)
    return {
      kind: 'member',
      userId: member.id,
      tokenId: null,
      login: member.login,
      name: member.name,
      agentName: null,
    };
  const generic = ['agent', 'agents', 'ai'].includes(
    parsed.agent.toLowerCase(),
  );
  const token = generic
    ? null
    : await db
        .prepare(
          `SELECT id, name FROM agent_tokens
           WHERE project_id = ? AND user_id = ? AND lower(name) = lower(?) AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY created_at DESC LIMIT 2`,
        )
        .bind(projectId, member.id, parsed.agent, Date.now())
        .all<{ id: string; name: string }>();
  const unique = token?.results.length === 1 ? token.results[0]! : null;
  return {
    kind: 'agent',
    userId: member.id,
    tokenId: unique?.id ?? null,
    login: member.login,
    name: member.name,
    agentName: unique?.name ?? null,
  };
}

export async function resolveMentions(projectId: string, body: string) {
  const resolved: ResolvedTarget[] = [];
  for (const parsed of parseMentions(body)) {
    const target = await resolveTarget(projectId, parsed);
    if (target) resolved.push(target);
  }
  return resolved;
}

function targetLabel(target: ResolvedTarget) {
  return target.kind === 'agent'
    ? agentLabel(target.name, target.agentName ?? 'agent')
    : target.name;
}

// --- Reads -------------------------------------------------------------------

async function taskContext(projectId: string, taskId: string) {
  return database()
    .prepare(
      `SELECT t.id, t.task_number, t.title, t.status, t.archived_at, p.slug AS project_slug, ${TURN_ROW_COLUMNS}
       FROM tasks t JOIN projects p ON p.id = t.project_id ${TURN_ROW_JOINS}
       WHERE t.id = ? AND t.project_id = ?`,
    )
    .bind(taskId, projectId)
    .first<
      TurnRow & {
        id: string;
        task_number: number | null;
        title: string;
        status: string;
        archived_at: number | null;
        project_slug: string | null;
      }
    >();
}

export async function getTaskTurn(projectId: string, taskId: string) {
  await ensureSchema();
  const row = await taskContext(projectId, taskId);
  return row ? (mapTurn(row) ?? null) : null;
}

function taskRef(row: { id: string; task_number: number | null }) {
  return row.task_number ? `KANBY-${row.task_number}` : row.id.slice(0, 8);
}

// --- Writes ------------------------------------------------------------------

export class TurnTaskNotFoundError extends Error {
  constructor() {
    super('Task was not found or is archived');
  }
}

function resolveOpenMentionsStatement(
  projectId: string,
  taskId: string,
  userId: string,
  at: number,
) {
  return database()
    .prepare(
      `UPDATE task_mentions SET resolved_at = ?
       WHERE project_id = ? AND task_id = ? AND target_user_id = ? AND resolved_at IS NULL`,
    )
    .bind(at, projectId, taskId, userId);
}

export async function setTaskTurn(input: {
  projectId: string;
  taskId: string;
  target: TurnTarget | null;
  reason: TurnReason | null;
  note: string | null;
  actor: CollabActor;
}) {
  await ensureSchema();
  const db = database();
  const context = await taskContext(input.projectId, input.taskId);
  if (!context || context.archived_at !== null)
    throw new TurnTaskNotFoundError();
  const previous = mapTurn(context) ?? null;
  const now = Date.now();
  const target = input.target;
  const reason = target ? (input.reason ?? 'developing') : null;
  const note = target
    ? input.note?.trim().slice(0, MAX_TURN_NOTE_LENGTH) || null
    : null;
  let targetLabelText: string | null = null;
  if (target) {
    const member = await db
      .prepare(
        `SELECT u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = ? AND pm.user_id = ?`,
      )
      .bind(input.projectId, target.userId)
      .first<{ name: string }>();
    if (!member) return null;
    let agentName: string | null = null;
    if (target.kind === 'agent' && target.tokenId) {
      const token = await db
        .prepare(
          'SELECT name FROM agent_tokens WHERE id = ? AND project_id = ? AND user_id = ? AND revoked_at IS NULL',
        )
        .bind(target.tokenId, input.projectId, target.userId)
        .first<{ name: string }>();
      if (!token) return null;
      agentName = token.name;
    }
    targetLabelText =
      target.kind === 'agent'
        ? agentLabel(member.name, agentName ?? 'agent')
        : member.name;
  }
  const rejected = Boolean(
    previous?.reason === 'awaiting_acceptance' &&
    target &&
    (reason === 'developing' || reason === 'blocked'),
  );
  const actorName = actorDisplayName(input.actor);
  const summary = !target
    ? `${actorName} 清除了轮次`
    : rejected
      ? `${actorName} 打回了验收，交给 ${targetLabelText}`
      : `${actorName} 交给 ${targetLabelText} · ${TURN_REASON_LABELS[reason!]}`;
  const eventId = crypto.randomUUID();
  const kind = rejected ? 'turn.rejected' : 'turn.changed';
  const metadata = {
    from: previous
      ? {
          kind: previous.kind,
          userId: previous.user.id,
          tokenId: previous.tokenId,
          reason: previous.reason,
        }
      : null,
    to: target ? { ...target, reason, label: targetLabelText } : null,
  };
  await db.batch([
    db
      .prepare(
        `UPDATE tasks SET turn_kind = ?, turn_user_id = ?, turn_token_id = ?, turn_reason = ?, turn_note = ?, turn_since = ?
         WHERE id = ? AND project_id = ? AND archived_at IS NULL`,
      )
      .bind(
        target?.kind ?? null,
        target?.userId ?? null,
        target?.kind === 'agent' ? target.tokenId : null,
        reason,
        note,
        target ? now : null,
        input.taskId,
        input.projectId,
      ),
    prepareTaskActivityStatement(db, {
      id: eventId,
      projectId: input.projectId,
      taskId: input.taskId,
      kind,
      ...activityActor(input.actor),
      summary,
      body: note,
      metadata,
      createdAt: now,
    }),
    resolveOpenMentionsStatement(
      input.projectId,
      input.taskId,
      input.actor.userId,
      now,
    ),
  ]);
  const turn = await getTaskTurn(input.projectId, input.taskId);
  if (
    target &&
    turn &&
    !(input.actor.source === 'user' && input.actor.userId === target.userId)
  ) {
    await notifyTaskEvent({
      projectId: input.projectId,
      projectSlug: context.project_slug,
      taskId: input.taskId,
      taskRef: taskRef(context),
      taskTitle: context.title,
      kind: (rejected
        ? 'turn.rejected'
        : 'turn.changed') satisfies NotificationEventKind,
      actorName,
      recipients: [{ userId: target.userId, name: turn.label }],
      reasonLabel: turn.reasonLabel,
      note,
    });
  }
  return { turn, eventId, rejected, previous };
}

export async function postTaskComment(input: {
  projectId: string;
  taskId: string;
  body: string;
  actor: CollabActor;
}) {
  await ensureSchema();
  const db = database();
  const context = await taskContext(input.projectId, input.taskId);
  if (!context) throw new TurnTaskNotFoundError();
  const mentions = await resolveMentions(input.projectId, input.body);
  const now = Date.now();
  const eventId = crypto.randomUUID();
  const actorName = actorDisplayName(input.actor);
  const statements: D1PreparedStatement[] = [
    // Replying on the card answers any request addressed to this member.
    resolveOpenMentionsStatement(
      input.projectId,
      input.taskId,
      input.actor.userId,
      now,
    ),
    prepareTaskActivityStatement(db, {
      id: eventId,
      projectId: input.projectId,
      taskId: input.taskId,
      kind: 'comment.created',
      ...activityActor(input.actor),
      summary: mentions.length
        ? `${actorName} 评论并提到了 ${mentions.map(targetLabel).join('、')}`
        : `${actorName} 发表了评论`,
      body: input.body,
      metadata: mentions.length
        ? {
            mentions: mentions.map((mention) => ({
              kind: mention.kind,
              userId: mention.userId,
              tokenId: mention.tokenId,
              login: mention.login,
              label: targetLabel(mention),
            })),
          }
        : null,
      createdAt: now,
    }),
  ];
  for (const mention of mentions) {
    // A member mentioning themself is a no-op; their agent mentioning them is
    // a real request for the owner's attention.
    if (input.actor.source === 'user' && mention.userId === input.actor.userId)
      continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO task_mentions (id, project_id, task_id, event_id, target_user_id, target_token_id, target_kind, created_by, created_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          input.projectId,
          input.taskId,
          eventId,
          mention.userId,
          mention.tokenId,
          mention.kind,
          input.actor.tokenId ?? input.actor.userId,
          now,
        ),
    );
  }
  await db.batch(statements);
  const event = await db
    .prepare(
      `SELECT id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, created_at
       FROM task_events WHERE id = ? AND project_id = ?`,
    )
    .bind(eventId, input.projectId)
    .first<Record<string, unknown>>();
  const recipients = mentions
    .filter(
      (mention) =>
        !(
          input.actor.source === 'user' && mention.userId === input.actor.userId
        ),
    )
    .map((mention) => ({ userId: mention.userId, name: targetLabel(mention) }));
  if (recipients.length)
    await notifyTaskEvent({
      projectId: input.projectId,
      projectSlug: context.project_slug,
      taskId: input.taskId,
      taskRef: taskRef(context),
      taskTitle: context.title,
      kind: 'mention',
      actorName,
      recipients,
      reasonLabel: null,
      note: input.body,
    });
  return { event: event ? mapEventRow(event) : null, mentions };
}

function mapEventRow(row: Record<string, unknown>): TaskActivityEvent {
  let metadata: Record<string, unknown> | null = null;
  if (typeof row.metadata === 'string') {
    try {
      const parsed = JSON.parse(row.metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    source: row.source as TaskActivityEvent['source'],
    kind: String(row.kind),
    actor: {
      id: (row.actor_id as string | null) ?? null,
      name: String(row.actor_name),
      login: (row.actor_login as string | null) ?? null,
      avatarUrl: (row.actor_avatar_url as string | null) ?? null,
    },
    summary: String(row.summary),
    body: (row.body as string | null) ?? null,
    metadata,
    createdAt: Number(row.created_at),
  };
}

// --- Agent reading: thread, unread and cursors ------------------------------

export async function getReadCursor(taskId: string, readerId: string) {
  await ensureSchema();
  const row = await database()
    .prepare(
      'SELECT read_at FROM task_read_cursors WHERE task_id = ? AND reader_id = ?',
    )
    .bind(taskId, readerId)
    .first<{ read_at: number }>();
  return row ? Number(row.read_at) : null;
}

export async function markTaskRead(
  projectId: string,
  taskId: string,
  readerId: string,
  at = Date.now(),
) {
  if (recoverySnapshot()) return;
  await ensureSchema();
  await database()
    .prepare(
      `INSERT INTO task_read_cursors (task_id, reader_id, project_id, read_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id, reader_id) DO UPDATE SET read_at = MAX(task_read_cursors.read_at, excluded.read_at)`,
    )
    .bind(taskId, readerId, projectId, at)
    .run();
}

const EVENT_COLUMNS =
  'id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, created_at';

/** Conversation-level thread for an agent: recent entries plus what is new. */
export async function agentTaskThread(input: {
  projectId: string;
  taskId: string;
  readerId: string;
  limit?: number;
}) {
  await ensureSchema();
  const db = database();
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const lastReadAt = await getReadCursor(input.taskId, input.readerId);
  const [recent, unread] = await Promise.all([
    db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM task_events
         WHERE project_id = ? AND task_id = ? AND kind IN (${conversationPlaceholders})
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(input.projectId, input.taskId, ...CONVERSATION_KINDS, limit)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM task_events
         WHERE project_id = ? AND task_id = ? AND kind IN (${conversationPlaceholders})
           AND created_at > ? AND NOT (source = 'agent' AND actor_id = ?)
         ORDER BY created_at DESC, id DESC LIMIT 21`,
      )
      .bind(
        input.projectId,
        input.taskId,
        ...CONVERSATION_KINDS,
        lastReadAt ?? -1,
        input.readerId,
      )
      .all<Record<string, unknown>>(),
  ]);
  return {
    lastReadAt,
    thread: recent.results.map(mapEventRow).reverse(),
    unread: unread.results.slice(0, 20).map(mapEventRow).reverse(),
    unreadTruncated: unread.results.length > 20,
  };
}

// --- Queues ------------------------------------------------------------------

export type TurnQueueItem = {
  type: 'turn' | 'mention';
  taskId: string;
  ref: string;
  title: string;
  status: string;
  since: number;
  turn: TaskTurn | null;
  mention: {
    id: string;
    targetKind: 'member' | 'agent';
    targetTokenId: string | null;
    by: string;
    body: string | null;
    eventId: string;
  } | null;
  unreadCount?: number;
};

/**
 * Cards waiting on a member (and on that member's agents), oldest first.
 * With `tokenId`, the queue is the agent's view: its own turns, generic
 * turns for the owner's agents, and the owner's personal turns.
 */
export async function listTurnQueue(input: {
  projectId: string;
  userId: string;
  tokenId?: string | null;
}): Promise<TurnQueueItem[]> {
  await ensureSchema();
  const db = database();
  const tokenId = input.tokenId ?? null;
  const [turns, mentions] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.task_number, t.title, t.status, ${TURN_ROW_COLUMNS}
         FROM tasks t ${TURN_ROW_JOINS}
         WHERE t.project_id = ? AND t.turn_user_id = ? AND t.archived_at IS NULL AND t.status != 'shipped'
           AND (? IS NULL OR t.turn_kind = 'member' OR t.turn_token_id IS NULL OR t.turn_token_id = ?)
         ORDER BY t.turn_since ASC, t.id ASC LIMIT 100`,
      )
      .bind(input.projectId, input.userId, tokenId, tokenId)
      .all<
        TurnRow & {
          id: string;
          task_number: number | null;
          title: string;
          status: string;
        }
      >(),
    db
      .prepare(
        `SELECT m.id, m.task_id, m.target_kind, m.target_token_id, m.event_id, m.created_at,
                t.task_number, t.title, t.status, e.actor_name, e.actor_login, e.source, e.body,
                u.name AS actor_user_name
         FROM task_mentions m
         JOIN tasks t ON t.id = m.task_id AND t.project_id = m.project_id
         LEFT JOIN task_events e ON e.id = m.event_id
         LEFT JOIN users u ON u.login = e.actor_login
         WHERE m.project_id = ? AND m.target_user_id = ? AND m.resolved_at IS NULL
           AND t.archived_at IS NULL AND t.status != 'shipped'
           AND (? IS NULL OR m.target_token_id IS NULL OR m.target_token_id = ?)
         ORDER BY m.created_at ASC, m.id ASC LIMIT 100`,
      )
      .bind(input.projectId, input.userId, tokenId, tokenId)
      .all<{
        id: string;
        task_id: string;
        target_kind: 'member' | 'agent';
        target_token_id: string | null;
        event_id: string;
        created_at: number;
        task_number: number | null;
        title: string;
        status: string;
        actor_name: string | null;
        actor_login: string | null;
        source: string | null;
        body: string | null;
        actor_user_name: string | null;
      }>(),
  ]);
  const items: TurnQueueItem[] = [
    ...turns.results.map((row) => ({
      type: 'turn' as const,
      taskId: row.id,
      ref: taskRef(row),
      title: row.title,
      status: row.status,
      since: Number(row.turn_since ?? 0),
      turn: mapTurn(row) ?? null,
      mention: null,
    })),
    ...mentions.results.map((row) => ({
      type: 'mention' as const,
      taskId: row.task_id,
      ref: taskRef({ id: row.task_id, task_number: row.task_number }),
      title: row.title,
      status: row.status,
      since: Number(row.created_at),
      turn: null,
      mention: {
        id: row.id,
        targetKind: row.target_kind,
        targetTokenId: row.target_token_id,
        by:
          row.source === 'agent' && row.actor_user_name && row.actor_name
            ? agentLabel(row.actor_user_name, row.actor_name)
            : (row.actor_name ?? ''),
        body: row.body,
        eventId: row.event_id,
      },
    })),
  ];
  return items.sort(
    (left, right) =>
      left.since - right.since || left.taskId.localeCompare(right.taskId),
  );
}

/** Number of conversation entries by others since the reader's cursor. */
export async function unreadCounts(
  projectId: string,
  taskIds: string[],
  readerId: string,
) {
  await ensureSchema();
  const counts = new Map<string, number>();
  const unique = [...new Set(taskIds)].slice(0, 100);
  if (!unique.length) return counts;
  const result = await database()
    .prepare(
      `SELECT e.task_id, COUNT(*) AS unread FROM task_events e
       LEFT JOIN task_read_cursors c ON c.task_id = e.task_id AND c.reader_id = ?
       WHERE e.project_id = ? AND e.task_id IN (${unique.map(() => '?').join(', ')})
         AND e.kind IN (${conversationPlaceholders})
         AND e.created_at > COALESCE(c.read_at, -1)
         AND NOT (e.source = 'agent' AND e.actor_id = ?)
       GROUP BY e.task_id`,
    )
    .bind(readerId, projectId, ...unique, ...CONVERSATION_KINDS, readerId)
    .all<{ task_id: string; unread: number }>();
  for (const row of result.results) counts.set(row.task_id, Number(row.unread));
  return counts;
}
