import { database } from '@/lib/db';
import {
  calculateTeamMetrics,
  type MetricEvent,
  type MemberEvent,
  type MetricPeriod,
  type MetricState,
} from '@/lib/team-metrics';

export class MetricCapacityError extends Error {}
export async function readTeamMetrics(projectId: string, period: MetricPeriod) {
  const db = database();
  const now = Date.now();
  const coverage = await db
    .prepare('SELECT started_at FROM metric_coverage WHERE id=1')
    .first<{ started_at: number }>();
  if (!coverage) throw new Error('Metric collection baseline is missing');
  // One SQLite read snapshot for both histories. Never silently truncate a report.
  const result = await db
    .prepare(`
    SELECT 'task' AS category, sequence, task_id AS entity, occurred_at, kind, state, NULL AS name, NULL AS active
    FROM task_metric_events WHERE project_id=? AND occurred_at<?
    UNION ALL
    SELECT 'member' AS category, sequence, user_id AS entity, occurred_at, NULL AS kind, NULL AS state, name, active
    FROM member_metric_events WHERE project_id=? AND occurred_at<?
    ORDER BY occurred_at, sequence LIMIT 50001
  `)
    .bind(
      projectId,
      Math.min(now, period.end),
      projectId,
      Math.min(now, period.end),
    )
    .all<{
      category: string;
      sequence: number;
      entity: string;
      occurred_at: number;
      kind: string;
      state: string;
      name: string;
      active: number;
    }>();
  if (result.results.length > 50000)
    throw new MetricCapacityError(
      'Project history exceeds the report limit; no partial metrics were returned.',
    );
  const events: MetricEvent[] = [],
    members: MemberEvent[] = [];
  for (const r of result.results) {
    if (r.category === 'task')
      events.push({
        sequence: r.sequence,
        taskId: r.entity,
        at: r.occurred_at,
        kind: r.kind,
        state: JSON.parse(r.state) as MetricState,
      });
    else
      members.push({
        sequence: r.sequence,
        userId: r.entity,
        name: r.name,
        at: r.occurred_at,
        active: Boolean(r.active),
      });
  }
  return calculateTeamMetrics({
    period,
    events,
    members,
    coverageFrom: coverage.started_at,
    now,
  });
}
