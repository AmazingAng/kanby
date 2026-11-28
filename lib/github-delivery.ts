import { database } from '@/lib/db';
import { notifyTaskEvent } from '@/lib/notifications';
import { prepareTaskActivityStatement } from '@/lib/task-activity';
import { TURN_REASON_LABELS } from '@/lib/task-turn';

type GitHubDeliverySignal =
  | { kind: 'review'; userId: string }
  | { kind: 'changes'; userId: string; reviewerId: string }
  | { kind: 'merge'; base: string };

type DeliveryEvent = {
  deliveryId: string;
  repositoryId: string;
  projectIds: string[];
  number: number;
  url: string;
  eventAt: number;
  actorLogin: string;
  actorAvatarUrl: string | null;
  signal: GitHubDeliverySignal;
};

async function recordDefaultMerge(
  db: D1Database,
  event: DeliveryEvent,
  base: string,
) {
  await db
    .prepare(`
    INSERT OR IGNORE INTO github_delivery_default_merges (repository_id, item_number, merged_at)
    SELECT r.id, ?, ? FROM github_repositories r
    WHERE r.id = ? AND r.default_branch = ? AND r.active = 1
      AND EXISTS (SELECT 1 FROM github_delivery_repositories pilot
        JOIN github_task_links link ON link.project_id = pilot.project_id AND link.repository_id = pilot.repository_id
        WHERE pilot.repository_id = r.id AND link.kind = 'pull_request' AND link.item_number = ?)
  `)
    .bind(event.number, event.eventAt, event.repositoryId, base, event.number)
    .run();
}

export async function applyGitHubDeliverySignal(event: DeliveryEvent) {
  const db = database();
  const acceptance = event.signal.kind === 'merge';
  const assignedUserId =
    event.signal.kind === 'merge' ? null : event.signal.userId;
  if (event.signal.kind === 'merge')
    await recordDefaultMerge(db, event, event.signal.base);
  const tasks = await db
    .prepare(`
    SELECT t.id, t.project_id, assigned.id AS assigned_id, assigned.name AS assigned_name, t.title, t.task_number, project.slug,
      pilot.repository_id AS pilot_repository_id,
      (SELECT MAX(merged.merged_at) FROM github_task_links pilot_pr
        JOIN github_delivery_default_merges merged ON merged.repository_id = pilot_pr.repository_id AND merged.item_number = pilot_pr.item_number
        WHERE pilot_pr.project_id = t.project_id AND pilot_pr.task_id = t.id
          AND pilot_pr.kind = 'pull_request' AND pilot_pr.repository_id = pilot.repository_id) AS default_merge_at
    FROM github_task_links pr
    JOIN tasks t ON t.id = pr.task_id AND t.project_id = pr.project_id
    JOIN users assigned ON assigned.id = COALESCE(?, t.owner_id)
    JOIN projects project ON project.id = t.project_id
    JOIN github_delivery_repositories pilot ON pilot.project_id = t.project_id
    JOIN github_project_repositories selected ON selected.project_id = pilot.project_id AND selected.repository_id = pilot.repository_id
    WHERE pr.repository_id = ? AND pr.kind = 'pull_request' AND pr.item_number = ?
      AND (pr.repository_id = pilot.repository_id OR ? = 1)
      AND t.archived_at IS NULL AND t.status <> 'shipped'
      AND (? = 1 OR pr.state = 'open')
  `)
    .bind(
      assignedUserId,
      event.repositoryId,
      event.number,
      acceptance,
      acceptance,
    )
    .all<{
      id: string;
      project_id: string;
      assigned_id: string;
      assigned_name: string;
      title: string;
      task_number: number | null;
      slug: string | null;
      pilot_repository_id: string;
      default_merge_at: number | null;
    }>();

  const reason = acceptance
    ? 'awaiting_acceptance'
    : event.signal.kind === 'review'
      ? 'awaiting_review'
      : 'developing';
  for (const task of tasks.results) {
    if (!event.projectIds.includes(task.project_id)) continue;
    if (acceptance && task.default_merge_at === null) continue;
    const userId = task.assigned_id;
    const reviewerId =
      event.signal.kind === 'changes' ? event.signal.reviewerId : null;
    const at = acceptance
      ? Math.max(event.eventAt, task.default_merge_at ?? 0)
      : event.eventAt;
    const note = `GitHub PR #${event.number} · ${TURN_REASON_LABELS[reason]}`;
    const dedupeKey = `github:${event.deliveryId}:${task.id}:turn`;
    const now = Date.now();
    const [handoff] = await db.batch([
      db
        .prepare(`
        UPDATE tasks SET status = 'building', turn_kind = 'member', turn_user_id = ?, turn_token_id = NULL,
          turn_reason = ?, turn_note = ?, turn_since = ?, updated_at = MAX(updated_at + 1, ?)
        WHERE id = ? AND project_id = ? AND archived_at IS NULL AND status <> 'shipped'
          AND COALESCE(turn_since, 0) < ?
          AND (turn_reason IS NULL OR turn_reason <> 'awaiting_acceptance')
          AND (turn_reason IS NOT ? OR turn_user_id IS NOT ?)
          AND EXISTS (SELECT 1 FROM project_members member WHERE member.project_id = tasks.project_id AND member.user_id = ?)
          AND (? IS NULL OR EXISTS (SELECT 1 FROM project_members reviewer WHERE reviewer.project_id = tasks.project_id AND reviewer.user_id = ?))
          AND (? = 0 OR tasks.owner_id = ?)
          AND EXISTS (SELECT 1 FROM github_delivery_repositories WHERE project_id = tasks.project_id AND repository_id = ?)
          AND EXISTS (SELECT 1 FROM github_task_links current_pr WHERE current_pr.project_id = tasks.project_id
            AND current_pr.task_id = tasks.id AND current_pr.repository_id = ? AND current_pr.kind = 'pull_request'
            AND current_pr.item_number = ? AND current_pr.state = ?)
          AND (? = 0 OR NOT EXISTS (SELECT 1 FROM github_task_links pending WHERE pending.task_id = tasks.id
            AND pending.project_id = tasks.project_id AND pending.kind = 'pull_request' AND pending.state <> 'merged'))
          AND NOT EXISTS (SELECT 1 FROM task_events manual WHERE manual.project_id = tasks.project_id
            AND manual.task_id = tasks.id AND manual.kind IN ('turn.changed', 'turn.rejected')
            AND manual.source IN ('user', 'agent') AND manual.created_at >= ?)
          AND NOT EXISTS (SELECT 1 FROM task_events WHERE project_id = tasks.project_id AND dedupe_key = ?)
      `)
        .bind(
          userId,
          reason,
          note,
          at,
          now,
          task.id,
          task.project_id,
          at,
          reason,
          userId,
          userId,
          reviewerId,
          reviewerId,
          acceptance,
          userId,
          task.pilot_repository_id,
          event.repositoryId,
          event.number,
          acceptance ? 'merged' : 'open',
          acceptance,
          at,
          dedupeKey,
        ),
      prepareTaskActivityStatement(
        db,
        {
          projectId: task.project_id,
          taskId: task.id,
          source: 'github',
          kind: `github.turn.${reason}`,
          actorId: event.actorLogin,
          actorName: event.actorLogin,
          actorLogin: event.actorLogin,
          actorAvatarUrl: event.actorAvatarUrl,
          summary: note,
          metadata: { url: event.url, userId, reason, eventAt: at },
          dedupeKey,
          createdAt: at,
        },
        { onlyIfPreviousStatementChanged: true },
      ),
      db
        .prepare(
          'UPDATE projects SET updated_at = MAX(updated_at + 1, ?) WHERE id = ? AND changes() > 0',
        )
        .bind(now, task.project_id),
    ]);
    if (Number(handoff?.meta.changes ?? 0) === 1) {
      await notifyTaskEvent({
        projectId: task.project_id,
        projectSlug: task.slug,
        taskId: task.id,
        taskRef:
          task.task_number === null
            ? task.id.slice(0, 8)
            : `KANBY-${task.task_number}`,
        taskTitle: task.title,
        kind: 'turn.changed',
        actorName: event.actorLogin,
        recipients: [{ userId, name: task.assigned_name }],
        reasonLabel: TURN_REASON_LABELS[reason],
        note,
      });
    }
  }
}
