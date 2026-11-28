import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { processGitHubWebhook } from '@/lib/github-webhook';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  linkGitHubRepository,
  seedProject,
  seedTask,
} from './support/fixtures';

function closedIssue(stateReason?: string) {
  return JSON.stringify({
    action: 'closed',
    installation: { id: 77 },
    repository: { id: 501, full_name: 'test/repo' },
    sender: { login: 'alice' },
    issue: {
      number: 9,
      title: 'Old issue',
      html_url: 'https://github.com/test/repo/issues/9',
      state: 'closed',
      state_reason: stateReason,
    },
  });
}

describe('GitHub history backfill', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    database.sqlite
      .prepare(
        `INSERT INTO github_repositories (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
         VALUES ('501', '77', 'repo', 'test/repo', 'https://github.com/test/repo', 'main', 0, 1, 1)`,
      )
      .run();
    linkGitHubRepository(database, '501');
    const task = seedTask(database, { id: 'task-issue' });
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links (task_id, project_id, repository_id, kind, item_number, url, title, state, updated_at)
         VALUES (?, 'project-1', '501', 'issue', 9, 'https://github.com/test/repo/issues/9', 'Old issue', 'open', 1)`,
      )
      .run(task.id);
  });

  afterEach(() => database.close());

  const status = () =>
    (
      database.sqlite
        .prepare("SELECT status FROM tasks WHERE id = 'task-issue'")
        .get() as { status: string }
    ).status;

  it('records events and links but never moves cards', async () => {
    await processGitHubWebhook('issues', 'backfill:501:9', closedIssue(), {
      onlyProjectId: 'project-1',
      backfill: true,
    });
    expect(status()).toBe('ideas');
    expect(
      database.sqlite
        .prepare(
          "SELECT state FROM github_task_links WHERE task_id = 'task-issue'",
        )
        .get(),
    ).toEqual({ state: 'closed' });
    expect(
      database.sqlite.prepare('SELECT id FROM github_events').all(),
    ).toEqual([{ id: 'backfill:501:9:project-1' }]);
  });

  it('still applies completion automation to live webhooks', async () => {
    await processGitHubWebhook('issues', 'live-delivery', closedIssue());
    expect(status()).toBe('shipped');
  });

  it('does not complete a card when the issue was closed as not planned', async () => {
    await processGitHubWebhook(
      'issues',
      'live-not-planned',
      closedIssue('not_planned'),
    );
    expect(status()).toBe('ideas');
    await processGitHubWebhook(
      'issues',
      'live-completed',
      closedIssue('completed'),
    );
    expect(status()).toBe('shipped');
  });
});
