import type { AuthUser } from '@/lib/auth';
import {
  database,
  ensureSchema,
  listTasks,
  type ColumnId,
  type TaskRecord,
} from '@/lib/db';
import { prepareTaskActivityStatement } from '@/lib/task-activity';
export { isFailingCiStatus } from '@/lib/github-ci';

export type GitHubAutomationSettings = {
  issueTaskCreation: boolean;
  autoLinkPullRequests: boolean;
  pullRequestOpenStatus: ColumnId | null;
  completionStatus: ColumnId | null;
  showCiFailures: boolean;
};

export const DEFAULT_GITHUB_AUTOMATION: GitHubAutomationSettings = {
  issueTaskCreation: true,
  autoLinkPullRequests: true,
  pullRequestOpenStatus: 'building',
  completionStatus: 'shipped',
  showCiFailures: true,
};

const columns = new Set<ColumnId>(['ideas', 'building', 'shipped']);
type AutomationRow = {
  issue_task_creation: number;
  auto_link_pull_requests: number;
  pull_request_open_status: string | null;
  completion_status: string | null;
  show_ci_failures: number;
};

function optionalColumn(value: unknown): ColumnId | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && columns.has(value as ColumnId)
    ? (value as ColumnId)
    : undefined;
}

function mapAutomation(row: AutomationRow): GitHubAutomationSettings {
  const pullRequestOpenStatus = optionalColumn(row.pull_request_open_status);
  const completionStatus = optionalColumn(row.completion_status);
  return {
    issueTaskCreation: Boolean(row.issue_task_creation),
    autoLinkPullRequests: Boolean(row.auto_link_pull_requests),
    pullRequestOpenStatus:
      pullRequestOpenStatus === undefined
        ? DEFAULT_GITHUB_AUTOMATION.pullRequestOpenStatus
        : pullRequestOpenStatus,
    completionStatus:
      completionStatus === undefined
        ? DEFAULT_GITHUB_AUTOMATION.completionStatus
        : completionStatus,
    showCiFailures: Boolean(row.show_ci_failures),
  };
}

export function parseGitHubAutomationSettings(
  value: unknown,
): GitHubAutomationSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const pullRequestOpenStatus = optionalColumn(input.pullRequestOpenStatus);
  const completionStatus = optionalColumn(input.completionStatus);
  if (
    typeof input.issueTaskCreation !== 'boolean' ||
    typeof input.autoLinkPullRequests !== 'boolean' ||
    pullRequestOpenStatus === undefined ||
    completionStatus === undefined ||
    typeof input.showCiFailures !== 'boolean'
  )
    return null;
  return {
    issueTaskCreation: input.issueTaskCreation,
    autoLinkPullRequests: input.autoLinkPullRequests,
    pullRequestOpenStatus,
    completionStatus,
    showCiFailures: input.showCiFailures,
  };
}

export function extractKanbyTaskReference(input: {
  body?: string | null;
  branch?: string | null;
  title?: string | null;
  commits?: Array<string | null | undefined>;
}) {
  const sources = [
    input.branch,
    input.title,
    input.body,
    ...(input.commits ?? []),
  ].filter((value): value is string => typeof value === 'string');
  for (const source of sources) {
    const key = source.match(/(?:^|[^A-Z0-9])KANBY-(\d{1,9})(?![A-Z0-9])/i);
    if (key) return `kanby-${Number(key[1])}`;
  }
  const trailer = input.body?.match(
    /(?:^|\n)\s*Kanby-Task:\s*([0-9a-f][0-9a-f-]{7,79})\s*(?:\n|$)/i,
  );
  const branch = input.branch?.match(
    /^kanby\/([0-9a-f][0-9a-f-]{7,79})(?:[-_/].*)?$/i,
  );
  return (trailer?.[1] ?? branch?.[1] ?? null)?.toLowerCase() ?? null;
}

export async function getProjectGitHubAutomation(
  projectId: string,
): Promise<GitHubAutomationSettings> {
  await ensureSchema();
  const row = await database()
    .prepare(
      `SELECT issue_task_creation, auto_link_pull_requests, pull_request_open_status,
              completion_status, show_ci_failures
       FROM github_automation_settings WHERE project_id = ?`,
    )
    .bind(projectId)
    .first<AutomationRow>();
  return row ? mapAutomation(row) : { ...DEFAULT_GITHUB_AUTOMATION };
}

export async function setProjectGitHubAutomation(
  projectId: string,
  userId: string,
  settings: GitHubAutomationSettings,
): Promise<GitHubAutomationSettings> {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const statements = [
    db
      .prepare(
        `INSERT INTO github_automation_settings
         (project_id, issue_task_creation, auto_link_pull_requests, pull_request_open_status,
          completion_status, show_ci_failures, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           issue_task_creation = excluded.issue_task_creation,
           auto_link_pull_requests = excluded.auto_link_pull_requests,
           pull_request_open_status = excluded.pull_request_open_status,
           completion_status = excluded.completion_status,
           show_ci_failures = excluded.show_ci_failures,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .bind(
        projectId,
        settings.issueTaskCreation ? 1 : 0,
        settings.autoLinkPullRequests ? 1 : 0,
        settings.pullRequestOpenStatus,
        settings.completionStatus,
        settings.showCiFailures ? 1 : 0,
        userId,
        now,
      ),
    db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(now, projectId),
  ];
  if (!settings.showCiFailures) {
    statements.push(
      db
        .prepare(
          'UPDATE github_task_links SET ci_status = NULL, updated_at = ? WHERE project_id = ?',
        )
        .bind(now, projectId),
    );
  }
  await db.batch(statements);
  return getProjectGitHubAutomation(projectId);
}

type IssueEventRow = {
  repository_id: string;
  item_number: number;
  title: string;
  url: string;
  action: string;
};

export type GitHubIssueImportResult = {
  task: TaskRecord;
  created: boolean;
};

async function importedTask(projectId: string, taskId: string) {
  return (
    (await listTasks(projectId)).find((task) => task.id === taskId) ?? null
  );
}

export async function importGitHubIssueTask(
  projectId: string,
  eventId: string,
  user: AuthUser,
): Promise<GitHubIssueImportResult | null | 'disabled'> {
  await ensureSchema();
  const settings = await getProjectGitHubAutomation(projectId);
  if (!settings.issueTaskCreation) return 'disabled';
  const db = database();
  const event = await db
    .prepare(
      `SELECT ge.repository_id, ge.item_number, ge.title, ge.url, ge.action
       FROM github_events ge
       JOIN github_project_repositories gpr
         ON gpr.project_id = ge.project_id AND gpr.repository_id = ge.repository_id
       WHERE ge.id = ? AND ge.project_id = ? AND ge.kind = 'issues'
         AND ge.item_number IS NOT NULL AND ge.url IS NOT NULL`,
    )
    .bind(eventId, projectId)
    .first<IssueEventRow>();
  if (!event) return null;

  const existing = await db
    .prepare(
      `SELECT task_id FROM github_issue_imports
       WHERE project_id = ? AND repository_id = ? AND item_number = ?`,
    )
    .bind(projectId, event.repository_id, event.item_number)
    .first<{ task_id: string }>();
  if (existing) {
    const task = await importedTask(projectId, existing.task_id);
    return task ? { task, created: false } : null;
  }

  const linked = await db
    .prepare(
      `SELECT task_id FROM github_task_links
       WHERE project_id = ? AND repository_id = ? AND kind = 'issue' AND item_number = ?
       LIMIT 1`,
    )
    .bind(projectId, event.repository_id, event.item_number)
    .first<{ task_id: string }>();
  if (linked) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO github_issue_imports
         (id, project_id, repository_id, item_number, task_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        projectId,
        event.repository_id,
        event.item_number,
        linked.task_id,
        user.id,
        Date.now(),
      )
      .run();
    const task = await importedTask(projectId, linked.task_id);
    return task ? { task, created: false } : null;
  }

  const taskId = crypto.randomUUID();
  const importId = crypto.randomUUID();
  const now = Date.now();
  const title =
    event.title.trim().slice(0, 160) || `GitHub Issue #${event.item_number}`;
  const state = event.action === 'closed' ? 'closed' : 'open';
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO github_issue_imports
         (id, project_id, repository_id, item_number, task_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        importId,
        projectId,
        event.repository_id,
        event.item_number,
        taskId,
        user.id,
        now,
      ),
    db
      .prepare(
        `INSERT INTO tasks
         (id, project_id, task_number, title, note, tag, owner_id, owner_login, owner_name,
          owner_avatar_url, due, status, position, created_at, updated_at, archived_at, created_by)
         SELECT ?, ?, (SELECT COALESCE(MAX(task_number), 0) + 1 FROM tasks WHERE project_id = ?), ?, ?, '代码', ?, ?, ?, ?, NULL, 'ideas',
                COALESCE((SELECT MAX(position) + 1 FROM tasks WHERE project_id = ? AND status = 'ideas' AND archived_at IS NULL), 0),
                ?, ?, NULL, ?
         WHERE EXISTS (
           SELECT 1 FROM github_issue_imports
           WHERE id = ? AND project_id = ? AND task_id = ?
         )`,
      )
      .bind(
        taskId,
        projectId,
        projectId,
        title,
        event.url,
        user.id,
        user.login,
        user.name,
        user.avatarUrl,
        projectId,
        now,
        now,
        user.id,
        importId,
        projectId,
        taskId,
      ),
    db
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url,
          title, state, ci_status, updated_at)
         SELECT ?, ?, ?, 'issue', ?, NULL, ?, ?, ?, NULL, ?
         WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ?)`,
      )
      .bind(
        taskId,
        projectId,
        event.repository_id,
        event.item_number,
        event.url,
        title,
        state,
        now,
        taskId,
        projectId,
      ),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ?
         AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ?)`,
      )
      .bind(now, projectId, taskId, projectId),
    prepareTaskActivityStatement(
      db,
      {
        projectId,
        taskId,
        source: 'user',
        kind: 'task.created_from_github_issue',
        actorId: user.id,
        actorName: user.name,
        actorLogin: user.login,
        actorAvatarUrl: user.avatarUrl,
        summary: `${user.name} 从 GitHub Issue 创建了任务`,
        body: `${title} · #${event.item_number}`,
        metadata: { url: event.url, itemNumber: event.item_number },
        dedupeKey: `github-issue-import:${event.repository_id}:${event.item_number}`,
        createdAt: now,
      },
      { onlyIfTaskUpdatedAt: now },
    ),
  ]);

  const imported = await db
    .prepare(
      `SELECT task_id FROM github_issue_imports
       WHERE project_id = ? AND repository_id = ? AND item_number = ?`,
    )
    .bind(projectId, event.repository_id, event.item_number)
    .first<{ task_id: string }>();
  if (!imported) return null;
  const task = await importedTask(projectId, imported.task_id);
  return task ? { task, created: imported.task_id === taskId } : null;
}

export async function autoLinkPullRequest(input: {
  repositoryId: string;
  number: number;
  title: string;
  state: string;
  url: string;
  branch: string;
  body: string;
  commits?: string[];
  deliveryId: string;
  actorLogin: string;
  actorAvatarUrl: string | null;
}) {
  await ensureSchema();
  const reference = extractKanbyTaskReference(input);
  if (!reference) return 0;
  const numericReference = reference.match(/^kanby-(\d+)$/)?.[1] ?? null;
  const db = database();
  const candidates = await db
    .prepare(
      `SELECT t.id, t.project_id, t.updated_at
       FROM tasks t
       JOIN github_project_repositories gpr ON gpr.project_id = t.project_id
       LEFT JOIN github_automation_settings gas ON gas.project_id = t.project_id
       WHERE gpr.repository_id = ?
         AND COALESCE(gas.auto_link_pull_requests, 1) = 1
         AND t.archived_at IS NULL
         AND (
           (? IS NOT NULL AND t.task_number = CAST(? AS INTEGER))
           OR (? IS NULL AND (lower(t.id) = ? OR lower(substr(t.id, 1, length(?))) = ?))
         )
       LIMIT 2`,
    )
    .bind(
      input.repositoryId,
      numericReference,
      numericReference,
      numericReference,
      reference,
      reference,
      reference,
    )
    .all<{ id: string; project_id: string; updated_at: number }>();
  if (candidates.results.length !== 1) return 0;
  const task = candidates.results[0];
  const now = Math.max(Date.now(), Number(task.updated_at) + 1);
  await db.batch([
    db
      .prepare(
        `INSERT INTO github_task_links
           (task_id, project_id, repository_id, kind, item_number, branch, url,
            title, state, ci_status, updated_at)
           VALUES (?, ?, ?, 'pull_request', ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(task_id) DO UPDATE SET
             repository_id = excluded.repository_id,
             kind = excluded.kind,
             item_number = excluded.item_number,
             branch = excluded.branch,
             url = excluded.url,
             title = excluded.title,
             state = excluded.state,
             ci_status = NULL,
             updated_at = excluded.updated_at`,
      )
      .bind(
        task.id,
        task.project_id,
        input.repositoryId,
        input.number,
        input.branch,
        input.url,
        input.title,
        input.state,
        now,
      ),
    db
      .prepare(
        `UPDATE tasks SET updated_at = ?
           WHERE id = ? AND project_id = ? AND archived_at IS NULL`,
      )
      .bind(now, task.id, task.project_id),
    db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(now, task.project_id),
    prepareTaskActivityStatement(
      db,
      {
        projectId: task.project_id,
        taskId: task.id,
        source: 'github',
        kind: 'github.pull_request.auto_linked',
        actorId: input.actorLogin,
        actorName: input.actorLogin,
        actorLogin: input.actorLogin,
        actorAvatarUrl: input.actorAvatarUrl,
        summary: `${input.actorLogin} 创建的 PR 已自动关联`,
        body: `${input.title} · #${input.number}`,
        metadata: { url: input.url, branch: input.branch },
        dedupeKey: `github:${input.deliveryId}:${task.id}:auto-link`,
        createdAt: now,
      },
      { onlyIfTaskUpdatedAt: now },
    ),
  ]);
  return 1;
}

export async function recordReferencedPush(input: {
  repositoryId: string;
  branch: string;
  commits: string[];
  deliveryId: string;
  actorLogin: string;
  actorAvatarUrl: string | null;
  url: string | null;
}) {
  await ensureSchema();
  const reference = extractKanbyTaskReference({
    branch: input.branch,
    commits: input.commits,
  });
  if (!reference) return 0;
  const numericReference = reference.match(/^kanby-(\d+)$/)?.[1] ?? null;
  const db = database();
  const candidates = await db
    .prepare(
      `SELECT t.id, t.project_id, t.updated_at
       FROM tasks t
       JOIN github_project_repositories gpr ON gpr.project_id = t.project_id
       LEFT JOIN github_automation_settings gas ON gas.project_id = t.project_id
       WHERE gpr.repository_id = ?
         AND (gas.auto_link_pull_requests IS NULL OR gas.auto_link_pull_requests = 1)
         AND t.archived_at IS NULL
         AND ((? IS NOT NULL AND t.task_number = CAST(? AS INTEGER))
              OR (? IS NULL AND (lower(t.id) = ? OR lower(substr(t.id, 1, length(?))) = ?)))
       LIMIT 2`,
    )
    .bind(
      input.repositoryId,
      numericReference,
      numericReference,
      numericReference,
      reference,
      reference,
      reference,
    )
    .all<{ id: string; project_id: string; updated_at: number }>();
  if (candidates.results.length !== 1) return 0;
  const task = candidates.results[0];
  const now = Math.max(Date.now(), Number(task.updated_at) + 1);
  await db.batch([
    db
      .prepare(
        'UPDATE tasks SET updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL',
      )
      .bind(now, task.id, task.project_id),
    db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(now, task.project_id),
    prepareTaskActivityStatement(
      db,
      {
        projectId: task.project_id,
        taskId: task.id,
        source: 'github',
        kind: 'github.push.referenced',
        actorId: input.actorLogin,
        actorName: input.actorLogin,
        actorLogin: input.actorLogin,
        actorAvatarUrl: input.actorAvatarUrl,
        summary: `${input.actorLogin} 推送了关联提交`,
        body: input.commits[0]?.split('\n')[0].slice(0, 240) ?? input.branch,
        metadata: { url: input.url, branch: input.branch },
        dedupeKey: `github:${input.deliveryId}:${task.id}:push-reference`,
        createdAt: now,
      },
      { onlyIfTaskUpdatedAt: now },
    ),
  ]);
  return 1;
}
