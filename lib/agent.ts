import {
  database,
  ensureSchema,
  type ColumnId,
  type TaskRecord,
} from '@/lib/db';
import type { AuthUser } from '@/lib/auth';
import { agentTokenLabel } from '@/lib/agent-token-policy';

const encoder = new TextEncoder();
const DEFAULT_SCOPES = ['task:read', 'task:write'] as const;
const MAX_ACTIVE_TOKENS_PER_MEMBER = 10;

export type AgentIdentity = {
  tokenId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  userId: string;
  userLogin: string;
  userName: string;
  userAvatarUrl: string | null;
  agentName: string;
  scopes: Set<string>;
};

export type AgentTokenRecord = {
  id: string;
  name: string;
  label: string;
  user: AuthUser;
  prefix: string;
  scopes: string[];
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

type PendingIdempotencyEnvelope = {
  __kanbyIdempotency: 1;
  state: 'pending';
  requestHash: string;
  ownerNonce: string;
};

type CompletedIdempotencyEnvelope = {
  __kanbyIdempotency: 1;
  state: 'complete';
  requestHash: string;
  status: number;
  response: unknown;
};

export type IdempotencyReservation = {
  tokenId: string;
  key: string;
  operation: string;
  pendingJson: string;
  requestHash: string;
};

export type IdempotencyDecision =
  | { kind: 'acquired'; reservation: IdempotencyReservation }
  | { kind: 'cached'; response: unknown; status: number }
  | { kind: 'conflict' }
  | { kind: 'in_progress' };

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createAgentToken(input: {
  projectId: string;
  user: AuthUser;
  name: string;
  expiresAt: number | null;
}) {
  await ensureSchema();
  const id = crypto.randomUUID();
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const token = `kby_${id}_${base64Url(secretBytes)}`;
  const now = Date.now();
  const inserted = await database()
    .prepare(
      `INSERT INTO agent_tokens (id, project_id, user_id, name, token_hash, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?
       WHERE EXISTS (
         SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?
       ) AND (
         SELECT COUNT(*) FROM agent_tokens
         WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
       ) < ?`,
    )
    .bind(
      id,
      input.projectId,
      input.user.id,
      input.name,
      await sha256(token),
      token.slice(0, 13),
      DEFAULT_SCOPES.join(','),
      input.expiresAt,
      now,
      input.projectId,
      input.user.id,
      input.projectId,
      input.user.id,
      now,
      MAX_ACTIVE_TOKENS_PER_MEMBER,
    )
    .run();
  if (Number(inserted.meta.changes ?? 0) === 0) return null;
  return {
    token,
    record: {
      id,
      name: input.name,
      label: agentTokenLabel(input.user.login, input.name),
      user: input.user,
      prefix: token.slice(0, 13),
      scopes: [...DEFAULT_SCOPES],
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
    } satisfies AgentTokenRecord,
  };
}

export async function listAgentTokens(
  projectId: string,
  viewerUserId: string,
  includeProjectTokens: boolean,
): Promise<AgentTokenRecord[]> {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT at.id, at.name, at.token_prefix, at.scopes, at.expires_at, at.last_used_at, at.revoked_at, at.created_at,
              u.id AS user_id, u.login AS user_login, u.name AS user_name, u.avatar_url AS user_avatar_url
       FROM agent_tokens at JOIN users u ON u.id = at.user_id
       WHERE at.project_id = ?
         AND EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = at.project_id AND pm.user_id = ?
         )
         AND (? = 1 OR at.user_id = ?)
       ORDER BY at.created_at DESC, at.id DESC`,
    )
    .bind(projectId, viewerUserId, includeProjectTokens ? 1 : 0, viewerUserId)
    .all<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: string;
      expires_at: number | null;
      last_used_at: number | null;
      revoked_at: number | null;
      created_at: number;
      user_id: string;
      user_login: string;
      user_name: string;
      user_avatar_url: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    label: agentTokenLabel(row.user_login, row.name),
    user: {
      id: row.user_id,
      login: row.user_login,
      name: row.user_name,
      avatarUrl: row.user_avatar_url,
    },
    prefix: row.token_prefix,
    scopes: row.scopes.split(',').filter(Boolean),
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));
}

export async function revokeAgentToken(
  projectId: string,
  tokenId: string,
  actorUserId: string,
  canManageProject: boolean,
) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `UPDATE agent_tokens SET revoked_at = ?
       WHERE id = ? AND project_id = ? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = agent_tokens.project_id AND pm.user_id = ?
         )
         AND (? = 1 OR user_id = ?)`,
    )
    .bind(
      Date.now(),
      tokenId,
      projectId,
      actorUserId,
      canManageProject ? 1 : 0,
      actorUserId,
    )
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function authenticateAgent(
  request: Request,
  requiredScope: 'task:read' | 'task:write',
): Promise<AgentIdentity | null> {
  await ensureSchema();
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
  const match = /^kby_([0-9a-f-]{36})_[A-Za-z0-9_-]{40,}$/.exec(token);
  if (!match) return null;
  const row = await database()
    .prepare(
      `SELECT at.id, at.project_id, at.user_id, at.name, at.token_hash, at.scopes, at.expires_at, at.revoked_at,
            p.name AS project_name, p.slug AS project_slug,
            u.login AS user_login, u.name AS user_name, u.avatar_url AS user_avatar_url
     FROM agent_tokens at
     JOIN projects p ON p.id = at.project_id
     JOIN project_members pm ON pm.project_id = at.project_id AND pm.user_id = at.user_id
     JOIN users u ON u.id = at.user_id
     WHERE at.id = ? LIMIT 1`,
    )
    .bind(match[1])
    .first<{
      id: string;
      project_id: string;
      user_id: string;
      name: string;
      token_hash: string;
      scopes: string;
      expires_at: number | null;
      revoked_at: number | null;
      project_name: string;
      project_slug: string;
      user_login: string;
      user_name: string;
      user_avatar_url: string | null;
    }>();
  if (
    !row ||
    row.revoked_at ||
    (row.expires_at && row.expires_at <= Date.now()) ||
    !secureEqual(await sha256(token), row.token_hash)
  )
    return null;
  const scopes = new Set(row.scopes.split(',').filter(Boolean));
  if (!scopes.has(requiredScope)) return null;
  await database()
    .prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?')
    .bind(Date.now(), row.id)
    .run();
  return {
    tokenId: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectSlug: row.project_slug,
    userId: row.user_id,
    userLogin: row.user_login,
    userName: row.user_name,
    userAvatarUrl: row.user_avatar_url,
    agentName: row.name,
    scopes,
  };
}

export function publicTask(task: TaskRecord) {
  return {
    ...task,
    ref: task.number ? `KANBY-${task.number}` : task.id.slice(0, 8),
    legacyRef: task.id.slice(0, 8),
  };
}

export async function resolveAgentTask(projectId: string, reference: string) {
  await ensureSchema();
  const normalized = reference.trim();
  const taskNumber = /^KANBY-(\d{1,9})$/i.exec(normalized)?.[1] ?? null;
  if (!taskNumber && (normalized.length < 6 || normalized.length > 80))
    return null;
  const result = await database()
    .prepare(
      `SELECT id FROM tasks WHERE project_id = ? AND (
         (? IS NOT NULL AND task_number = CAST(? AS INTEGER))
         OR (? IS NULL AND (id = ? OR id LIKE ?))
       ) ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 2`,
    )
    .bind(
      projectId,
      taskNumber,
      taskNumber,
      taskNumber,
      normalized,
      `${normalized}%`,
      normalized,
    )
    .all<{ id: string }>();
  return result.results.length === 1 ? result.results[0].id : null;
}

export async function getTaskClaim(taskId: string) {
  await ensureSchema();
  const row = await database()
    .prepare(
      `SELECT agent_name, lease_expires_at, updated_at FROM task_agent_claims WHERE task_id = ? AND lease_expires_at > ?`,
    )
    .bind(taskId, Date.now())
    .first<{
      agent_name: string;
      lease_expires_at: number;
      updated_at: number;
    }>();
  return row
    ? {
        agentName: row.agent_name,
        leaseExpiresAt: row.lease_expires_at,
        updatedAt: row.updated_at,
      }
    : null;
}

export async function claimTask(
  identity: AgentIdentity,
  taskId: string,
  leaseMinutes: number,
) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const expiresAt = now + Math.min(Math.max(leaseMinutes, 1), 60) * 60_000;
  await db
    .prepare(
      'DELETE FROM task_agent_claims WHERE task_id = ? AND lease_expires_at <= ?',
    )
    .bind(taskId, now)
    .run();
  await db
    .prepare(
      `INSERT INTO task_agent_claims (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at
     WHERE task_agent_claims.token_id = excluded.token_id`,
    )
    .bind(
      taskId,
      identity.projectId,
      identity.tokenId,
      identity.agentName,
      expiresAt,
      now,
      now,
    )
    .run();
  const owner = await db
    .prepare(
      'SELECT token_id, agent_name, lease_expires_at FROM task_agent_claims WHERE task_id = ?',
    )
    .bind(taskId)
    .first<{
      token_id: string;
      agent_name: string;
      lease_expires_at: number;
    }>();
  return owner?.token_id === identity.tokenId
    ? {
        ok: true as const,
        agentName: owner.agent_name,
        leaseExpiresAt: owner.lease_expires_at,
      }
    : {
        ok: false as const,
        agentName: owner?.agent_name ?? 'another agent',
        leaseExpiresAt: owner?.lease_expires_at ?? expiresAt,
      };
}

export async function heartbeatTask(
  identity: AgentIdentity,
  taskId: string,
  leaseMinutes: number,
) {
  await ensureSchema();
  const now = Date.now();
  const expiresAt = now + Math.min(Math.max(leaseMinutes, 1), 60) * 60_000;
  const result = await database()
    .prepare(
      'UPDATE task_agent_claims SET lease_expires_at = ?, updated_at = ? WHERE task_id = ? AND project_id = ? AND token_id = ? AND lease_expires_at > ?',
    )
    .bind(expiresAt, now, taskId, identity.projectId, identity.tokenId, now)
    .run();
  return Number(result.meta.changes ?? 0) > 0
    ? { agentName: identity.agentName, leaseExpiresAt: expiresAt }
    : null;
}

export async function releaseTask(identity: AgentIdentity, taskId: string) {
  await ensureSchema();
  const result = await database()
    .prepare(
      'DELETE FROM task_agent_claims WHERE task_id = ? AND project_id = ? AND token_id = ?',
    )
    .bind(taskId, identity.projectId, identity.tokenId)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function canMutateTask(identity: AgentIdentity, taskId: string) {
  await ensureSchema();
  const claim = await database()
    .prepare(
      'SELECT token_id FROM task_agent_claims WHERE task_id = ? AND project_id = ? AND lease_expires_at > ?',
    )
    .bind(taskId, identity.projectId, Date.now())
    .first<{ token_id: string }>();
  return !claim || claim.token_id === identity.tokenId;
}

export async function recordAgentUpdate(
  identity: AgentIdentity,
  taskId: string,
  kind: string,
  message: string,
  metadata?: Record<string, unknown>,
  requireClaimAccess = false,
) {
  await ensureSchema();
  const db = database();
  const createdAt = Date.now();
  const id = crypto.randomUUID();
  const updateStatement = db
    .prepare(
      `INSERT INTO task_agent_updates (id, project_id, task_id, token_id, kind, message, metadata, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ? = 0 OR NOT EXISTS (
       SELECT 1 FROM task_agent_claims
       WHERE task_id = ? AND project_id = ? AND lease_expires_at > ? AND token_id != ?
     )`,
    )
    .bind(
      id,
      identity.projectId,
      taskId,
      identity.tokenId,
      kind,
      message,
      metadata ? JSON.stringify(metadata) : null,
      createdAt,
      requireClaimAccess ? 1 : 0,
      taskId,
      identity.projectId,
      Date.now(),
      identity.tokenId,
    );
  const claim =
    kind === 'heartbeat'
      ? await db
          .prepare(
            'SELECT created_at FROM task_agent_claims WHERE task_id = ? AND project_id = ? AND token_id = ?',
          )
          .bind(taskId, identity.projectId, identity.tokenId)
          .first<{ created_at: number }>()
      : null;
  const eventKind = ['created', 'updated'].includes(kind)
    ? `task.${kind}`
    : `agent.${kind}`;
  const summaries: Record<string, string> = {
    created: `${identity.agentName} 创建了任务`,
    updated: `${identity.agentName} 修改了任务`,
    claimed: `${identity.agentName} 领取了任务`,
    heartbeat: `${identity.agentName} 正在处理`,
    progress: `${identity.agentName} 汇报了进度`,
    released: `${identity.agentName} 释放了任务`,
    linked: `${identity.agentName} 关联了 GitHub 工作项`,
    completed: `${identity.agentName} 完成了任务`,
  };
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const results = await db.batch([
    updateStatement,
    prepareTaskActivityStatement(
      db,
      {
        projectId: identity.projectId,
        taskId,
        source: 'agent',
        kind: eventKind,
        actorId: identity.tokenId,
        actorName: identity.agentName,
        actorLogin: identity.userLogin,
        actorAvatarUrl: identity.userAvatarUrl,
        summary: summaries[kind] ?? `${identity.agentName} 更新了任务`,
        body: ['progress', 'completed'].includes(kind) ? message : null,
        metadata: { ...metadata, message },
        dedupeKey:
          kind === 'heartbeat' && claim
            ? `agent-heartbeat:${taskId}:${identity.tokenId}:${claim.created_at}`
            : null,
        createdAt,
      },
      { onlyIfAgentUpdateId: id },
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) return null;
  return {
    id,
    kind,
    message,
    metadata: metadata ?? null,
    agentName: identity.agentName,
    createdAt,
  };
}

export async function listAgentUpdates(taskId: string, limit = 20) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT tau.id, tau.kind, tau.message, tau.metadata, tau.created_at, at.name AS agent_name
     FROM task_agent_updates tau JOIN agent_tokens at ON at.id = tau.token_id
     WHERE tau.task_id = ? ORDER BY tau.created_at DESC LIMIT ?`,
    )
    .bind(taskId, Math.min(Math.max(limit, 1), 100))
    .all<{
      id: string;
      kind: string;
      message: string;
      metadata: string | null;
      created_at: number;
      agent_name: string;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    message: row.message,
    metadata: row.metadata ? (JSON.parse(row.metadata) as unknown) : null,
    agentName: row.agent_name,
    createdAt: row.created_at,
  }));
}

function idempotencyEnvelope(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isIdempotencyEnvelope(
  value: unknown,
): value is PendingIdempotencyEnvelope | CompletedIdempotencyEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '__kanbyIdempotency' in value &&
    value.__kanbyIdempotency === 1,
  );
}

export async function beginIdempotentRequest(
  tokenId: string,
  key: string,
  operation: string,
  requestBody: string,
): Promise<IdempotencyDecision> {
  await ensureSchema();
  const requestHash = await sha256(requestBody);
  const pending: PendingIdempotencyEnvelope = {
    __kanbyIdempotency: 1,
    state: 'pending',
    requestHash,
    ownerNonce: crypto.randomUUID(),
  };
  const pendingJson = JSON.stringify(pending);
  const inserted = await database()
    .prepare(
      'INSERT OR IGNORE INTO agent_idempotency_keys (token_id, key, operation, response_json, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(tokenId, key, operation, pendingJson, Date.now())
    .run();
  if (Number(inserted.meta.changes ?? 0) > 0) {
    return {
      kind: 'acquired',
      reservation: { tokenId, key, operation, pendingJson, requestHash },
    };
  }
  const row = await database()
    .prepare(
      'SELECT operation, response_json FROM agent_idempotency_keys WHERE token_id = ? AND key = ?',
    )
    .bind(tokenId, key)
    .first<{ operation: string; response_json: string }>();
  if (!row || row.operation !== operation) return { kind: 'conflict' };
  const stored = idempotencyEnvelope(row.response_json);
  if (!isIdempotencyEnvelope(stored))
    return { kind: 'cached', response: stored, status: 200 };
  if (stored.requestHash !== requestHash) return { kind: 'conflict' };
  return stored.state === 'pending'
    ? { kind: 'in_progress' }
    : { kind: 'cached', response: stored.response, status: stored.status };
}

export async function completeIdempotentRequest(
  reservation: IdempotencyReservation,
  response: unknown,
  status = 200,
) {
  const completed: CompletedIdempotencyEnvelope = {
    __kanbyIdempotency: 1,
    state: 'complete',
    requestHash: reservation.requestHash,
    status,
    response,
  };
  const result = await database()
    .prepare(
      'UPDATE agent_idempotency_keys SET response_json = ? WHERE token_id = ? AND key = ? AND operation = ? AND response_json = ?',
    )
    .bind(
      JSON.stringify(completed),
      reservation.tokenId,
      reservation.key,
      reservation.operation,
      reservation.pendingJson,
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1)
    throw new Error('Idempotency reservation was lost');
}

export async function abortIdempotentRequest(
  reservation: IdempotencyReservation,
) {
  await database()
    .prepare(
      'DELETE FROM agent_idempotency_keys WHERE token_id = ? AND key = ? AND operation = ? AND response_json = ?',
    )
    .bind(
      reservation.tokenId,
      reservation.key,
      reservation.operation,
      reservation.pendingJson,
    )
    .run();
}

export function validColumn(value: unknown): value is ColumnId {
  return value === 'ideas' || value === 'building' || value === 'shipped';
}
