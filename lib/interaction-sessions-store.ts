import { database } from '@/lib/db';
import type { AgentIdentity } from '@/lib/agent';
import { resolveAgentTask } from '@/lib/agent';
import {
  SessionError,
  initialState,
  liveness,
  transition,
  type SessionState,
  type SessionEventInput,
  type Provenance,
} from './interaction-sessions';

type SessionRow = {
  id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  token_id: string;
  agent_name: string;
  client: string;
  context: string | null;
  task_id: string | null;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
  revision: number;
  last_event_id: string;
  state_json: string;
  fingerprint: string;
};
export type EventRow = {
  session_id: string;
  id: string;
  sequence: number;
  created_at: number;
  kind: string;
  actor_id: string;
  provenance: Provenance;
  input_json: string;
  fingerprint: string;
};
export function eventView(row: EventRow) {
  return {
    ...JSON.parse(row.input_json),
    kind: row.kind,
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    at: row.created_at,
    actorId: row.actor_id,
    provenance: row.provenance,
  };
}
export function sessionView(row: SessionRow, now = Date.now()) {
  const state: SessionState = JSON.parse(row.state_json);
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    userName: row.user_name,
    agentName: row.agent_name,
    client: row.client,
    context: row.context,
    taskId: row.task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    ...state,
    liveness: liveness(state, now),
  };
}
export async function sessionRow(projectId: string, id: string) {
  const row = await database()
    .prepare('SELECT * FROM interaction_sessions WHERE project_id=? AND id=?')
    .bind(projectId, id)
    .first<SessionRow>();
  if (!row) throw new SessionError(404, 'Session not found');
  return row;
}
export async function startSession(
  identity: AgentIdentity,
  input: {
    id: string;
    client: string;
    context: string | null;
    task: string | null;
  },
) {
  const taskId = input.task
    ? await resolveAgentTask(identity.projectId, input.task)
    : null;
  if (input.task && !taskId) throw new SessionError(404, 'Task not found');
  const fingerprint = JSON.stringify({
    userId: identity.userId,
    client: input.client,
    context: input.context,
    taskId,
  });
  const now = Date.now(),
    state = initialState(now),
    db = database();
  const inserted = await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO interaction_sessions
   (id,project_id,user_id,user_name,token_id,agent_name,client,context,task_id,created_at,updated_at,ended_at,revision,last_event_id,state_json,fingerprint)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,?)`)
      .bind(
        input.id,
        identity.projectId,
        identity.userId,
        identity.userName,
        identity.tokenId,
        identity.agentName,
        input.client,
        input.context,
        taskId,
        now,
        now,
        input.id,
        JSON.stringify(state),
        fingerprint,
      ),
    db
      .prepare(`INSERT OR IGNORE INTO interaction_events (session_id,id,sequence,created_at,kind,actor_id,provenance,input_json,fingerprint)
   SELECT id,id,0,created_at,'start',user_id,'agent_reported','{}',fingerprint FROM interaction_sessions
   WHERE id=? AND project_id=? AND fingerprint=?`)
      .bind(input.id, identity.projectId, fingerprint),
  ]);
  const row = await sessionRow(identity.projectId, input.id);
  if (row.fingerprint !== fingerprint)
    throw new SessionError(409, 'Session ID already used with different input');
  return { ...sessionView(row), replayed: !Number(inserted[0].meta.changes) };
}
export async function appendSessionEvent(
  projectId: string,
  actorId: string,
  provenance: Provenance,
  input: {
    sessionId: string;
    eventId: string;
    revision: number;
    event: SessionEventInput;
  },
) {
  const db = database(),
    row = await sessionRow(projectId, input.sessionId);
  if (provenance === 'agent_reported' && row.user_id !== actorId)
    throw new SessionError(
      403,
      'Only the session member can write Agent events',
    );
  if (provenance === 'verified_user' && input.event.kind !== 'reply')
    throw new SessionError(400, 'Human endpoint accepts replies only');
  const fingerprint = JSON.stringify({
    revision: input.revision,
    actorId,
    provenance,
    event: input.event,
  });
  const existing = () =>
    db
      .prepare(
        'SELECT fingerprint FROM interaction_events WHERE session_id=? AND id=?',
      )
      .bind(row.id, input.eventId)
      .first<{ fingerprint: string }>();
  const replay = await existing();
  if (replay) {
    if (replay.fingerprint !== fingerprint)
      throw new SessionError(409, 'Event ID already used with different input');
    return sessionView(row);
  }
  if (row.revision !== input.revision)
    throw new SessionError(
      409,
      'Session revision changed; re-read before sending another event',
    );
  const at = Math.max(Date.now(), row.updated_at);
  const state = transition(
    JSON.parse(row.state_json),
    input.event,
    input.eventId,
    at,
  );
  const results = await db.batch([
    db
      .prepare(`UPDATE interaction_sessions SET state_json=?,updated_at=?,ended_at=?,revision=revision+1,last_event_id=?
   WHERE project_id=? AND id=? AND revision=?`)
      .bind(
        JSON.stringify(state),
        at,
        state.endedAt,
        input.eventId,
        projectId,
        row.id,
        input.revision,
      ),
    db
      .prepare(`INSERT INTO interaction_events (session_id,id,sequence,created_at,kind,actor_id,provenance,input_json,fingerprint)
   SELECT id,?,revision,updated_at,?,?,?, ?,? FROM interaction_sessions
   WHERE project_id=? AND id=? AND last_event_id=? AND revision=?
   AND NOT EXISTS (SELECT 1 FROM interaction_events WHERE session_id=? AND id=?)`)
      .bind(
        input.eventId,
        input.event.kind,
        actorId,
        provenance,
        JSON.stringify(input.event),
        fingerprint,
        projectId,
        row.id,
        input.eventId,
        input.revision + 1,
        row.id,
        input.eventId,
      ),
  ]);
  if (!Number(results[0].meta.changes)) {
    const concurrent = await existing();
    if (concurrent?.fingerprint !== fingerprint)
      throw new SessionError(
        409,
        'Session revision changed; re-read before sending another event',
      );
  }
  return sessionView(await sessionRow(projectId, row.id));
}
export function pageLimit(value: string | null) {
  const n = Number(value ?? 50);
  if (!Number.isInteger(n) || n < 1 || n > 50)
    throw new SessionError(400, 'Limit must be between 1 and 50');
  return n;
}
export async function listSessions(projectId: string, params: URLSearchParams) {
  const limit = pageLimit(params.get('limit')),
    cursor = params.get('cursor');
  let at = Number.MAX_SAFE_INTEGER,
    id = '~';
  if (cursor) {
    const match = /^(\d+):([a-f0-9-]{36})$/.exec(cursor);
    if (!match || !Number.isSafeInteger(Number(match[1])))
      throw new SessionError(400, 'Invalid session cursor');
    at = Number(match[1]);
    id = match[2];
  }
  const task = params.get('task');
  const taskId = task ? await resolveAgentTask(projectId, task) : null;
  if (task && !taskId) throw new SessionError(404, 'Task not found');
  const member = params.get('member');
  const { results } = await database()
    .prepare(`SELECT * FROM interaction_sessions WHERE project_id=?
  AND (created_at < ? OR (created_at=? AND id<?)) AND (? IS NULL OR task_id=?) AND (? IS NULL OR user_id=?)
  ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(projectId, at, at, id, taskId, taskId, member, member, limit + 1)
    .all<SessionRow>();
  const rows = results.slice(0, limit),
    last = rows.at(-1);
  return {
    sessions: rows.map((r) => sessionView(r)),
    nextCursor:
      results.length > limit ? `${last!.created_at}:${last!.id}` : null,
  };
}
export async function listSessionEvents(
  projectId: string,
  id: string,
  params: URLSearchParams,
) {
  await sessionRow(projectId, id);
  const limit = pageLimit(params.get('limit'));
  const cursor = params.get('cursor');
  if (
    cursor !== null &&
    (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
  )
    throw new SessionError(400, 'Invalid event cursor');
  const { results } = await database()
    .prepare(
      'SELECT * FROM interaction_events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?',
    )
    .bind(id, cursor === null ? -1 : Number(cursor), limit + 1)
    .all<EventRow>();
  const rows = results.slice(0, limit);
  return {
    events: rows.map(eventView),
    nextCursor: results.length > limit ? String(rows.at(-1)!.sequence) : null,
  };
}
