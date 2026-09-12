import { database, ensureSchema, type ColumnId } from '@/lib/db';
import type {
  GitHubInstallation,
  GitHubLinkedItem,
  GitHubRepository,
} from '@/lib/github';
import {
  getProjectGitHubAutomation,
  type GitHubAutomationSettings,
} from '@/lib/github-automation';

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

export type GitHubRepositoryRecord = {
  id: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  selected: boolean;
};

export type GitHubActivityRecord = {
  id: string;
  repositoryId: string;
  kind: string;
  action: string;
  itemNumber: number | null;
  taskId: string | null;
  title: string;
  summary: string;
  url: string | null;
  actorLogin: string;
  actorAvatarUrl: string | null;
  createdAt: number;
};

export type GitHubTaskLinkRecord = {
  taskId: string;
  repositoryId: string;
  repository: string;
  kind: 'issue' | 'pull_request';
  number: number;
  url: string;
  title: string;
  state: string;
  ciStatus: string | null;
  updatedAt: number;
};

type GitHubTaskActivityInput = {
  deliveryId: string;
  action: string;
  actorLogin: string;
  actorAvatarUrl: string | null;
  summary: string;
};

export async function createGitHubConnectionState(
  projectId: string,
  userId: string,
  state: string,
) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  await runBatches(db, [
    db
      .prepare('DELETE FROM github_connection_states WHERE expires_at < ?')
      .bind(now),
    db
      .prepare(
        'INSERT INTO github_connection_states (state, project_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
      )
      .bind(state, projectId, userId, now + 10 * 60 * 1000),
  ]);
}

export async function consumeGitHubConnectionState(
  state: string,
  userId: string,
) {
  await ensureSchema();
  const db = database();
  const row = await db
    .prepare(
      'SELECT project_id, expires_at FROM github_connection_states WHERE state = ? AND user_id = ?',
    )
    .bind(state, userId)
    .first<{ project_id: string; expires_at: number }>();
  await db
    .prepare('DELETE FROM github_connection_states WHERE state = ?')
    .bind(state)
    .run();
  return row && Number(row.expires_at) >= Date.now() ? row.project_id : null;
}

export async function saveGitHubInstallation(
  projectId: string,
  userId: string,
  installation: GitHubInstallation,
  repositories: GitHubRepository[],
) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const installationId = String(installation.id);
  const previousConnection = await db
    .prepare(
      'SELECT installation_id FROM github_project_installations WHERE project_id = ?',
    )
    .bind(projectId)
    .first<{ installation_id: string }>();
  const existing = await db
    .prepare(
      'SELECT repository_id FROM github_project_repositories WHERE project_id = ?',
    )
    .bind(projectId)
    .all<{ repository_id: string }>();
  const keepSelection = new Set(
    existing.results.map((row) => row.repository_id),
  );
  const firstConnection =
    !previousConnection ||
    previousConnection.installation_id !== installationId;
  await runBatches(db, [
    db
      .prepare(
        'UPDATE github_repositories SET active = 0 WHERE installation_id = ?',
      )
      .bind(installationId),
    db
      .prepare(
        `INSERT INTO github_installations (id, account_id, account_login, account_type, repository_selection, html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, account_login = excluded.account_login, account_type = excluded.account_type, repository_selection = excluded.repository_selection, html_url = excluded.html_url, updated_at = excluded.updated_at`,
      )
      .bind(
        installationId,
        String(installation.account.id),
        installation.account.login,
        installation.account.type,
        installation.repository_selection,
        installation.html_url ?? null,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO github_project_installations (project_id, installation_id, connected_by, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET installation_id = excluded.installation_id, connected_by = excluded.connected_by, created_at = excluded.created_at`,
      )
      .bind(projectId, installationId, userId, now),
    ...repositories.map((repository) =>
      db
        .prepare(
          `INSERT INTO github_repositories (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET installation_id = excluded.installation_id, name = excluded.name, full_name = excluded.full_name, html_url = excluded.html_url, default_branch = excluded.default_branch, private = excluded.private, active = 1, updated_at = excluded.updated_at`,
        )
        .bind(
          String(repository.id),
          installationId,
          repository.name,
          repository.full_name,
          repository.html_url,
          repository.default_branch,
          repository.private ? 1 : 0,
          now,
        ),
    ),
  ]);
  const accessible = new Set(
    repositories.map((repository) => String(repository.id)),
  );
  await db
    .prepare(
      `DELETE FROM github_project_repositories WHERE project_id = ? AND repository_id IN (
      SELECT id FROM github_repositories WHERE installation_id = ? AND active = 0
    )`,
    )
    .bind(projectId, installationId)
    .run();
  const selected = firstConnection
    ? accessible
    : new Set([...keepSelection].filter((id) => accessible.has(id)));
  if (selected.size > 0) {
    await runBatches(
      db,
      [...selected].map((repositoryId) =>
        db
          .prepare(
            'INSERT OR IGNORE INTO github_project_repositories (project_id, repository_id, created_at) VALUES (?, ?, ?)',
          )
          .bind(projectId, repositoryId, now),
      ),
    );
  }
}

export async function projectGitHubInstallation(projectId: string) {
  await ensureSchema();
  return database()
    .prepare(
      `SELECT gpi.installation_id, gi.account_login, gi.account_type, gi.repository_selection, gi.html_url
     FROM github_project_installations gpi JOIN github_installations gi ON gi.id = gpi.installation_id
     WHERE gpi.project_id = ?`,
    )
    .bind(projectId)
    .first<{
      installation_id: string;
      account_login: string;
      account_type: string;
      repository_selection: string;
      html_url: string | null;
    }>();
}

export async function projectGitHubSettings(projectId: string) {
  await ensureSchema();
  const db = database();
  const installation = await projectGitHubInstallation(projectId);
  if (!installation) return null;
  const [repositories, events, automation] = await Promise.all([
    db
      .prepare(
        `SELECT gr.id, gr.name, gr.full_name, gr.html_url, gr.default_branch, gr.private,
        CASE WHEN gpr.repository_id IS NULL THEN 0 ELSE 1 END AS selected
       FROM github_repositories gr
       LEFT JOIN github_project_repositories gpr ON gpr.repository_id = gr.id AND gpr.project_id = ?
       WHERE gr.installation_id = ? AND gr.active = 1 ORDER BY gr.full_name`,
      )
      .bind(projectId, installation.installation_id)
      .all<{
        id: string;
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
        private: number;
        selected: number;
      }>(),
    listGitHubActivity(projectId, 10),
    getProjectGitHubAutomation(projectId),
  ]);
  return {
    installationId: installation.installation_id,
    accountLogin: installation.account_login,
    accountType: installation.account_type,
    repositorySelection: installation.repository_selection,
    installationUrl: installation.html_url,
    repositories: repositories.results.map(
      (row): GitHubRepositoryRecord => ({
        id: row.id,
        name: row.name,
        fullName: row.full_name,
        htmlUrl: row.html_url,
        defaultBranch: row.default_branch,
        private: Boolean(row.private),
        selected: Boolean(row.selected),
      }),
    ),
    events,
    automation,
  };
}

export async function setProjectGitHubRepositories(
  projectId: string,
  repositoryIds: string[],
) {
  await ensureSchema();
  const db = database();
  const installation = await projectGitHubInstallation(projectId);
  if (!installation) return false;
  const unique = [...new Set(repositoryIds)].slice(0, 500);
  if (unique.length > 0) {
    const placeholders = unique.map(() => '?').join(', ');
    const allowed = await db
      .prepare(
        `SELECT id FROM github_repositories WHERE installation_id = ? AND active = 1 AND id IN (${placeholders})`,
      )
      .bind(installation.installation_id, ...unique)
      .all<{ id: string }>();
    if (allowed.results.length !== unique.length) return false;
  }
  const now = Date.now();
  const statements = [
    db
      .prepare('DELETE FROM github_project_repositories WHERE project_id = ?')
      .bind(projectId),
  ];
  statements.push(
    ...unique.map((repositoryId) =>
      db
        .prepare(
          'INSERT INTO github_project_repositories (project_id, repository_id, created_at) VALUES (?, ?, ?)',
        )
        .bind(projectId, repositoryId, now),
    ),
  );
  await runBatches(db, statements);
  return true;
}

export async function selectedGitHubRepository(
  projectId: string,
  fullName: string,
) {
  await ensureSchema();
  return database()
    .prepare(
      `SELECT gr.id, gr.installation_id FROM github_repositories gr
     JOIN github_project_repositories gpr ON gpr.repository_id = gr.id AND gpr.project_id = ?
     WHERE gr.active = 1 AND lower(gr.full_name) = lower(?) LIMIT 1`,
    )
    .bind(projectId, fullName)
    .first<{ id: string; installation_id: string }>();
}

export async function saveGitHubTaskLink(
  projectId: string,
  taskId: string,
  repositoryId: string,
  item: GitHubLinkedItem,
  agentTokenId?: string,
) {
  await ensureSchema();
  const now = Date.now();
  const tokenId = agentTokenId ?? null;
  const result = await database()
    .prepare(
      `INSERT INTO github_task_links (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
     WHERE ? IS NULL OR NOT EXISTS (
       SELECT 1 FROM task_agent_claims
       WHERE task_id = ? AND project_id = ? AND lease_expires_at > ? AND token_id != ?
     )
     ON CONFLICT(task_id) DO UPDATE SET repository_id = excluded.repository_id, kind = excluded.kind, item_number = excluded.item_number, branch = excluded.branch, url = excluded.url, title = excluded.title, state = excluded.state, ci_status = NULL, updated_at = excluded.updated_at`,
    )
    .bind(
      taskId,
      projectId,
      repositoryId,
      item.kind,
      item.number,
      item.branch,
      item.url,
      item.title,
      item.state,
      now,
      tokenId,
      taskId,
      projectId,
      Date.now(),
      tokenId,
    )
    .run();
  if (Number(result.meta.changes ?? 0) === 0) return null;
  return getGitHubTaskLink(projectId, taskId);
}

export async function getGitHubTaskLink(projectId: string, taskId: string) {
  await ensureSchema();
  const row = await database()
    .prepare(
      `SELECT gtl.task_id, gtl.repository_id, gr.full_name, gtl.kind, gtl.item_number, gtl.url, gtl.title, gtl.state, gtl.ci_status, gtl.updated_at
     FROM github_task_links gtl JOIN github_repositories gr ON gr.id = gtl.repository_id
     WHERE gtl.project_id = ? AND gtl.task_id = ?`,
    )
    .bind(projectId, taskId)
    .first<{
      task_id: string;
      repository_id: string;
      full_name: string;
      kind: 'issue' | 'pull_request';
      item_number: number;
      url: string;
      title: string;
      state: string;
      ci_status: string | null;
      updated_at: number;
    }>();
  return row
    ? ({
        taskId: row.task_id,
        repositoryId: row.repository_id,
        repository: row.full_name,
        kind: row.kind,
        number: Number(row.item_number),
        url: row.url,
        title: row.title,
        state: row.state,
        ciStatus: row.ci_status,
        updatedAt: Number(row.updated_at),
      } satisfies GitHubTaskLinkRecord)
    : null;
}

export async function deleteGitHubTaskLink(projectId: string, taskId: string) {
  await ensureSchema();
  await database()
    .prepare(
      'DELETE FROM github_task_links WHERE project_id = ? AND task_id = ?',
    )
    .bind(projectId, taskId)
    .run();
}

export async function listGitHubActivity(projectId: string, limit = 8) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT ge.id, ge.repository_id, ge.kind, ge.action, ge.item_number,
              ge.title, ge.summary, ge.url, ge.actor_login, ge.actor_avatar_url,
              ge.created_at, gii.task_id
       FROM github_events ge
       LEFT JOIN github_issue_imports gii
         ON gii.project_id = ge.project_id
        AND gii.repository_id = ge.repository_id
        AND gii.item_number = ge.item_number
       WHERE ge.project_id = ? ORDER BY ge.created_at DESC LIMIT ?`,
    )
    .bind(projectId, Math.min(Math.max(limit, 1), 30))
    .all<{
      id: string;
      repository_id: string;
      kind: string;
      action: string;
      item_number: number | null;
      task_id: string | null;
      title: string;
      summary: string;
      url: string | null;
      actor_login: string;
      actor_avatar_url: string | null;
      created_at: number;
    }>();
  return result.results.map(
    (row): GitHubActivityRecord => ({
      id: row.id,
      repositoryId: row.repository_id,
      kind: row.kind,
      action: row.action,
      itemNumber: row.item_number == null ? null : Number(row.item_number),
      taskId: row.task_id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      actorLogin: row.actor_login,
      actorAvatarUrl: row.actor_avatar_url,
      createdAt: Number(row.created_at),
    }),
  );
}

export async function startGitHubDelivery(
  deliveryId: string,
  event: string,
  payload = '{}',
  source?: { installationId?: string; repositoryId?: string },
) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO github_deliveries
       (id, event, received_at, processed_at, payload, status, attempt_count,
        last_error, next_retry_at, lease_expires_at, updated_at, installation_id,
        repository_id)
       VALUES (?, ?, ?, NULL, ?, 'processing', 1, NULL, NULL, ?, ?, ?, ?)`,
    )
    .bind(
      deliveryId,
      event,
      now,
      payload,
      now + 2 * 60 * 1000,
      now,
      source?.installationId ?? null,
      source?.repositoryId ?? null,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function finishGitHubDelivery(deliveryId: string) {
  await database()
    .prepare(
      `UPDATE github_deliveries
       SET processed_at = ?, payload = NULL, status = 'complete', last_error = NULL,
           next_retry_at = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(Date.now(), Date.now(), deliveryId)
    .run();
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

export function githubRetryDelay(attempt: number) {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(attempt - 1, 10));
}

export async function failGitHubDelivery(
  deliveryId: string,
  error: unknown = 'Webhook processing failed',
) {
  const db = database();
  const row = await db
    .prepare('SELECT attempt_count FROM github_deliveries WHERE id = ?')
    .bind(deliveryId)
    .first<{ attempt_count: number }>();
  const attempt = Math.max(1, Number(row?.attempt_count ?? 1));
  const now = Date.now();
  await database()
    .prepare(
      `UPDATE github_deliveries
       SET status = 'failed', last_error = ?, next_retry_at = ?,
           lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND processed_at IS NULL`,
    )
    .bind(boundedError(error), now + githubRetryDelay(attempt), now, deliveryId)
    .run();
}

export type RetryableGitHubDelivery = {
  id: string;
  event: string;
  payload: string;
};

export async function claimDueGitHubDeliveries(limit = 10, projectId?: string) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const projectScope = projectId
    ? `AND EXISTS (
         SELECT 1 FROM github_project_installations gpi
         JOIN github_project_repositories gpr ON gpr.project_id = gpi.project_id
         WHERE gpi.project_id = ?
           AND gpi.installation_id = gd.installation_id
           AND gpr.repository_id = gd.repository_id
       )`
    : '';
  const candidates = await db
    .prepare(
      `SELECT id FROM github_deliveries gd
       WHERE processed_at IS NULL AND payload IS NOT NULL
         AND (status = 'failed' AND next_retry_at <= ?
              OR status = 'processing' AND lease_expires_at < ?)
         ${projectScope}
       ORDER BY COALESCE(next_retry_at, received_at), received_at LIMIT ?`,
    )
    .bind(
      now,
      now,
      ...(projectId ? [projectId] : []),
      Math.min(Math.max(limit, 1), 25),
    )
    .all<{ id: string }>();
  const claimed: RetryableGitHubDelivery[] = [];
  for (const candidate of candidates.results) {
    const result = await db
      .prepare(
        `UPDATE github_deliveries
         SET status = 'processing', attempt_count = attempt_count + 1,
             lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND processed_at IS NULL AND payload IS NOT NULL
           AND (status = 'failed' AND next_retry_at <= ?
                OR status = 'processing' AND lease_expires_at < ?)`,
      )
      .bind(now + 2 * 60 * 1000, now, candidate.id, now, now)
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) continue;
    const row = await db
      .prepare('SELECT id, event, payload FROM github_deliveries WHERE id = ?')
      .bind(candidate.id)
      .first<RetryableGitHubDelivery>();
    if (row) claimed.push(row);
  }
  return claimed;
}

export async function githubReliabilitySummary(projectId: string) {
  await ensureSchema();
  const db = database();
  const [backlog, failures, sync] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM github_deliveries gd
         WHERE gd.processed_at IS NULL AND EXISTS (
           SELECT 1 FROM github_project_installations gpi
           JOIN github_project_repositories gpr ON gpr.project_id = gpi.project_id
           JOIN github_repositories gr ON gr.id = gpr.repository_id
           WHERE gpi.project_id = ? AND gr.installation_id = gd.installation_id
             AND gr.id = gd.repository_id
         )`,
      )
      .bind(projectId)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT id, event, attempt_count, last_error, next_retry_at, updated_at
         FROM github_deliveries gd WHERE status = 'failed' AND EXISTS (
           SELECT 1 FROM github_project_installations gpi
           JOIN github_project_repositories gpr ON gpr.project_id = gpi.project_id
           WHERE gpi.project_id = ? AND gpi.installation_id = gd.installation_id
             AND gpr.repository_id = gd.repository_id
         )
         ORDER BY updated_at DESC LIMIT 8`,
      )
      .bind(projectId)
      .all<{
        id: string;
        event: string;
        attempt_count: number;
        last_error: string | null;
        next_retry_at: number | null;
        updated_at: number | null;
      }>(),
    db
      .prepare(
        `SELECT status, item_count, error, started_at, finished_at
         FROM github_sync_runs WHERE project_id = ?
         ORDER BY started_at DESC LIMIT 1`,
      )
      .bind(projectId)
      .first<{
        status: string;
        item_count: number;
        error: string | null;
        started_at: number;
        finished_at: number | null;
      }>(),
  ]);
  return {
    backlog: Number(backlog?.count ?? 0),
    failures: failures.results.map((row) => ({
      id: row.id,
      event: row.event,
      attempts: Number(row.attempt_count),
      error: row.last_error,
      nextRetryAt: row.next_retry_at == null ? null : Number(row.next_retry_at),
      updatedAt: Number(row.updated_at ?? 0),
    })),
    lastSync: sync
      ? {
          status: sync.status,
          itemCount: Number(sync.item_count),
          error: sync.error,
          startedAt: Number(sync.started_at),
          finishedAt:
            sync.finished_at == null ? null : Number(sync.finished_at),
        }
      : null,
  };
}

export async function startGitHubSyncRun(projectId: string, kind: string) {
  await ensureSchema();
  const id = crypto.randomUUID();
  await database()
    .prepare(
      `INSERT INTO github_sync_runs
       (id, project_id, kind, status, item_count, error, started_at, finished_at)
       VALUES (?, ?, ?, 'running', 0, NULL, ?, NULL)`,
    )
    .bind(id, projectId, kind, Date.now())
    .run();
  return id;
}

export async function finishGitHubSyncRun(
  id: string,
  itemCount: number,
  error?: unknown,
) {
  await database()
    .prepare(
      `UPDATE github_sync_runs SET status = ?, item_count = ?, error = ?, finished_at = ?
       WHERE id = ?`,
    )
    .bind(
      error ? 'failed' : 'complete',
      itemCount,
      error ? boundedError(error) : null,
      Date.now(),
      id,
    )
    .run();
}

export async function reserveGitHubRedelivery(
  deliveryId: number,
  guid: string,
) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `INSERT INTO github_redelivery_attempts (delivery_id, guid, attempted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(delivery_id) DO UPDATE SET attempted_at = excluded.attempted_at
       WHERE github_redelivery_attempts.attempted_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM github_deliveries WHERE id = github_redelivery_attempts.guid
         )`,
    )
    .bind(String(deliveryId), guid, Date.now(), Date.now() - 15 * 60 * 1000)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function releaseGitHubRedelivery(deliveryId: number) {
  await database()
    .prepare('DELETE FROM github_redelivery_attempts WHERE delivery_id = ?')
    .bind(String(deliveryId))
    .run();
}

export async function selectedGitHubRepositoriesForProject(projectId: string) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT gr.id, gr.full_name, gr.default_branch, gpi.installation_id
       FROM github_project_repositories gpr
       JOIN github_repositories gr ON gr.id = gpr.repository_id AND gr.active = 1
       JOIN github_project_installations gpi ON gpi.project_id = gpr.project_id
       WHERE gpr.project_id = ? ORDER BY gr.full_name LIMIT 20`,
    )
    .bind(projectId)
    .all<{
      id: string;
      full_name: string;
      default_branch: string;
      installation_id: string;
    }>();
  return result.results;
}

export async function projectsForGitHubRepository(
  installationId: string,
  repositoryId: string,
) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT gpr.project_id FROM github_project_repositories gpr
     JOIN github_project_installations gpi ON gpi.project_id = gpr.project_id
     WHERE gpi.installation_id = ? AND gpr.repository_id = ?`,
    )
    .bind(installationId, repositoryId)
    .all<{ project_id: string }>();
  return result.results.map((row) => row.project_id);
}

export async function recordGitHubEvent(input: {
  id: string;
  projectId: string;
  repositoryId: string;
  kind: string;
  action: string;
  itemNumber?: number | null;
  title: string;
  summary: string;
  url: string | null;
  actorLogin: string;
  actorAvatarUrl: string | null;
  createdAt: number;
}) {
  await ensureSchema();
  await database()
    .prepare(
      `INSERT OR IGNORE INTO github_events (id, project_id, repository_id, kind, action, item_number, title, summary, url, actor_login, actor_avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.projectId,
      input.repositoryId,
      input.kind,
      input.action,
      input.itemNumber ?? null,
      input.title,
      input.summary,
      input.url,
      input.actorLogin,
      input.actorAvatarUrl,
      input.createdAt,
    )
    .run();
}

export async function updateLinkedTasksFromGitHub(input: {
  repositoryId: string;
  kind: 'issue' | 'pull_request';
  number: number;
  title: string;
  state: string;
  url: string;
  branch?: string | null;
  targetStatus?: ColumnId;
  automationTrigger?: 'pull_request_opened' | 'completed';
  activity?: GitHubTaskActivityInput;
}) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const links = await db
    .prepare(
      `WITH linked_tasks AS (
         SELECT task_id, project_id FROM github_task_links
         WHERE repository_id = ? AND kind = ? AND item_number = ?
         UNION
         SELECT task_id, project_id FROM github_issue_imports
         WHERE ? = 'issue' AND repository_id = ? AND item_number = ?
       )
       SELECT linked_tasks.task_id, linked_tasks.project_id, t.status, t.updated_at
       FROM linked_tasks JOIN tasks t
         ON t.id = linked_tasks.task_id AND t.project_id = linked_tasks.project_id`,
    )
    .bind(
      input.repositoryId,
      input.kind,
      input.number,
      input.kind,
      input.repositoryId,
      input.number,
    )
    .all<{
      task_id: string;
      project_id: string;
      status: ColumnId;
      updated_at: number;
    }>();
  const automation = new Map<string, GitHubAutomationSettings>();
  if (input.automationTrigger) {
    await Promise.all(
      [...new Set(links.results.map((link) => link.project_id))].map(
        async (projectId) =>
          automation.set(
            projectId,
            await getProjectGitHubAutomation(projectId),
          ),
      ),
    );
  }
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const statements = links.results.flatMap((link) => {
    const taskUpdatedAt = Math.max(now, Number(link.updated_at) + 1);
    const settings = automation.get(link.project_id);
    const configuredStatus =
      input.automationTrigger === 'pull_request_opened'
        ? settings?.pullRequestOpenStatus
        : input.automationTrigger === 'completed'
          ? settings?.completionStatus
          : undefined;
    const targetStatus =
      input.automationTrigger === 'pull_request_opened' &&
      link.status === 'shipped'
        ? null
        : (input.targetStatus ?? configuredStatus ?? null);
    const updates: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE github_task_links
           SET title = ?, state = ?, url = ?, branch = COALESCE(?, branch), updated_at = ?
           WHERE task_id = ? AND repository_id = ? AND kind = ? AND item_number = ?`,
        )
        .bind(
          input.title,
          input.state,
          input.url,
          input.branch ?? null,
          now,
          link.task_id,
          input.repositoryId,
          input.kind,
          input.number,
        ),
      db
        .prepare(
          'UPDATE tasks SET status = COALESCE(?, status), updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL',
        )
        .bind(targetStatus, taskUpdatedAt, link.task_id, link.project_id),
      db
        .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .bind(taskUpdatedAt, link.project_id),
    ];
    if (input.activity) {
      updates.push(
        prepareTaskActivityStatement(
          db,
          {
            projectId: link.project_id,
            taskId: link.task_id,
            source: 'github',
            kind: `github.${input.kind}.${input.activity.action}`,
            actorId: input.activity.actorLogin,
            actorName: input.activity.actorLogin,
            actorLogin: input.activity.actorLogin,
            actorAvatarUrl: input.activity.actorAvatarUrl,
            summary: `${input.activity.actorLogin} 更新了 GitHub 工作项`,
            body: input.activity.summary,
            metadata: {
              title: input.title,
              state: input.state,
              url: input.url,
              branch: input.branch ?? null,
            },
            dedupeKey: `github:${input.activity.deliveryId}:${link.task_id}:${input.kind}`,
            createdAt: taskUpdatedAt,
          },
          { onlyIfTaskUpdatedAt: taskUpdatedAt },
        ),
      );
    }
    return updates;
  });
  if (statements.length > 0) await runBatches(db, statements);
}

export async function updateLinkedTaskCi(
  repositoryId: string,
  branch: string,
  status: string,
  activity?: GitHubTaskActivityInput,
) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const links = await db
    .prepare(
      `SELECT gtl.task_id, gtl.project_id, t.updated_at
       FROM github_task_links gtl JOIN tasks t ON t.id = gtl.task_id AND t.project_id = gtl.project_id
       WHERE gtl.repository_id = ? AND gtl.branch = ? AND gtl.kind = 'pull_request'`,
    )
    .bind(repositoryId, branch)
    .all<{ task_id: string; project_id: string; updated_at: number }>();
  const automation = new Map<string, GitHubAutomationSettings>();
  await Promise.all(
    [...new Set(links.results.map((link) => link.project_id))].map(
      async (projectId) =>
        automation.set(projectId, await getProjectGitHubAutomation(projectId)),
    ),
  );
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const statements = links.results.flatMap((link) => {
    if (!automation.get(link.project_id)?.showCiFailures) return [];
    const taskUpdatedAt = Math.max(now, Number(link.updated_at) + 1);
    const updates: D1PreparedStatement[] = [
      db
        .prepare(
          'UPDATE github_task_links SET ci_status = ?, updated_at = ? WHERE task_id = ? AND project_id = ?',
        )
        .bind(status, now, link.task_id, link.project_id),
      db
        .prepare(
          'UPDATE tasks SET updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL',
        )
        .bind(taskUpdatedAt, link.task_id, link.project_id),
      db
        .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .bind(taskUpdatedAt, link.project_id),
    ];
    if (activity) {
      updates.push(
        prepareTaskActivityStatement(
          db,
          {
            projectId: link.project_id,
            taskId: link.task_id,
            source: 'github',
            kind: `github.ci.${status}`,
            actorId: activity.actorLogin,
            actorName: activity.actorLogin,
            actorLogin: activity.actorLogin,
            actorAvatarUrl: activity.actorAvatarUrl,
            summary: `${activity.actorLogin} 更新了 CI`,
            body: activity.summary,
            metadata: { status, branch },
            dedupeKey: `github:${activity.deliveryId}:${link.task_id}:ci`,
            createdAt: taskUpdatedAt,
          },
          { onlyIfTaskUpdatedAt: taskUpdatedAt },
        ),
      );
    }
    return updates;
  });
  if (statements.length > 0) await runBatches(db, statements);
}

export async function recordLinkedTaskPush(
  repositoryId: string,
  branch: string,
  activity: GitHubTaskActivityInput,
) {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const links = await db
    .prepare(
      `SELECT gtl.task_id, gtl.project_id, t.updated_at
       FROM github_task_links gtl JOIN tasks t ON t.id = gtl.task_id AND t.project_id = gtl.project_id
       WHERE gtl.repository_id = ? AND gtl.branch = ? AND gtl.kind = 'pull_request'
         AND t.archived_at IS NULL`,
    )
    .bind(repositoryId, branch)
    .all<{ task_id: string; project_id: string; updated_at: number }>();
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const statements = links.results.flatMap((link) => {
    const taskUpdatedAt = Math.max(now, Number(link.updated_at) + 1);
    return [
      db
        .prepare(
          'UPDATE tasks SET updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL',
        )
        .bind(taskUpdatedAt, link.task_id, link.project_id),
      db
        .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .bind(taskUpdatedAt, link.project_id),
      prepareTaskActivityStatement(
        db,
        {
          projectId: link.project_id,
          taskId: link.task_id,
          source: 'github',
          kind: 'github.push',
          actorId: activity.actorLogin,
          actorName: activity.actorLogin,
          actorLogin: activity.actorLogin,
          actorAvatarUrl: activity.actorAvatarUrl,
          summary: `${activity.actorLogin} 推送了代码`,
          body: activity.summary,
          metadata: { branch },
          dedupeKey: `github:${activity.deliveryId}:${link.task_id}:push`,
          createdAt: taskUpdatedAt,
        },
        { onlyIfTaskUpdatedAt: taskUpdatedAt },
      ),
    ];
  });
  if (statements.length > 0) await runBatches(db, statements);
}
