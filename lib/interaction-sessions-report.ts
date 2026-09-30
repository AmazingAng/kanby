import { database } from '@/lib/db';
import type { MetricPeriod } from './team-metrics';
import {
  SessionError,
  initialState,
  liveness,
  responseStats,
  transition,
  type SessionState,
  type SessionEventInput,
  type Provenance,
} from './interaction-sessions';

type ReportRow = {
  session_id: string;
  user_id: string;
  user_name: string;
  created_at: number;
  kind: string;
  id: string;
  provenance: Provenance;
  input_json: string;
  sequence: number;
};
function person(id: string, name: string) {
  return {
    id,
    name,
    sessions: 0,
    running: 0,
    paused: 0,
    ended: 0,
    staleSessions: 0,
    pendingWaits: 0,
    oldestWaitMs: 0,
    cancelledWaits: 0,
    reportedPrompts: 0,
    reported: [] as number[],
    verified: [] as number[],
  };
}
export function summarizeSessions(
  rows: ReportRow[],
  members: { id: string; name: string }[],
  period: MetricPeriod,
  now: number,
) {
  const cutoff = Math.min(now, period.end);
  const people = new Map(members.map((m) => [m.id, person(m.id, m.name)]));
  const states = new Map<string, { state: SessionState; userId: string }>();
  for (const row of rows) {
    if (row.created_at > now || row.created_at >= period.end) continue;
    let p = people.get(row.user_id);
    if (!p) {
      p = person(row.user_id, row.user_name);
      people.set(row.user_id, p);
    }
    if (row.kind === 'start') {
      p.sessions++;
      states.set(row.session_id, {
        state: initialState(row.created_at),
        userId: row.user_id,
      });
      continue;
    }
    const session = states.get(row.session_id);
    if (!session) throw new SessionError(422, 'Session history is incomplete');
    const event = JSON.parse(row.input_json) as SessionEventInput;
    if (row.created_at >= period.start) {
      if (row.kind === 'prompt') p.reportedPrompts++;
      if (row.kind === 'reply' && session.state.wait) {
        const elapsed = Math.max(0, row.created_at - session.state.wait.since);
        (row.provenance === 'verified_user' ? p.verified : p.reported).push(
          elapsed,
        );
      }
      if (row.kind === 'end' && session.state.wait) p.cancelledWaits++;
    }
    session.state = transition(session.state, event, row.id, row.created_at);
  }
  for (const { state, userId } of states.values()) {
    const p = people.get(userId)!;
    if (state.status === 'running') p.running++;
    if (state.status === 'paused') p.paused++;
    if (state.status === 'ended') p.ended++;
    if (liveness(state, cutoff) === 'stale') p.staleSessions++;
    if (state.wait) {
      p.pendingWaits++;
      p.oldestWaitMs = Math.max(
        p.oldestWaitMs,
        Math.max(0, cutoff - state.wait.since),
      );
    }
  }
  return {
    period: { ...period, cutoff, provisional: now < period.end },
    people: [...people.values()].map(({ reported, verified, ...p }) => ({
      ...p,
      reportedResponses: responseStats(reported),
      verifiedResponses: responseStats(verified),
    })),
  };
}
export async function sessionReport(projectId: string, period: MetricPeriod) {
  const now = Date.now();
  // One bounded statement reads all selected journals consistently, including pre-period waits.
  const { results } = await database()
    .prepare(`SELECT e.*,s.user_id,s.user_name FROM interaction_events e
  JOIN interaction_sessions s ON s.id=e.session_id WHERE s.project_id=? AND s.created_at<=? AND s.created_at<?
  AND (s.ended_at IS NULL OR s.ended_at>=?) AND e.created_at<=? AND e.created_at<?
  ORDER BY s.id,e.sequence LIMIT 10001`)
    .bind(projectId, now, period.end, period.start, now, period.end)
    .all<ReportRow>();
  if (results.length > 10000)
    throw new SessionError(
      422,
      'Session report exceeds 10000 events; request a smaller period',
    );
  const { results: members } = await database()
    .prepare(
      'SELECT u.id,u.name FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.id',
    )
    .bind(projectId)
    .all<{ id: string; name: string }>();
  const collection = await database()
    .prepare('SELECT started_at FROM interaction_collection WHERE id=1')
    .first<{ started_at: number }>();
  return {
    ...summarizeSessions(results, members, period, now),
    coverage: {
      from: collection?.started_at ?? null,
      complete: false,
      source: 'instrumented_sessions_only',
      reason:
        'Only received events are observed. Missing clients, failed submissions and offline time are unknown.',
    },
    definitions: {
      sessions: 'Instrumented sessions overlapping the period; not all work.',
      responses:
        'Wait-to-reply server receipt latency for replies in the period, grouped by session owner and split by provenance. Nearest-rank percentiles; calendar time, not labor time.',
      pending:
        'Unanswered waits at cutoff, including waits opened before the period. End without reply cancels a wait.',
      provenance:
        'Agent-reported prompts/replies do not prove human attention or review quality. Verified-user means an authenticated member submitted a reply.',
      staleAfterMs: 300000,
    },
  };
}
