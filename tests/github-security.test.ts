import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  projectGitHubSettings,
  recordLinkedTaskPush,
  saveGitHubInstallation,
  startGitHubDelivery,
  updateLinkedTaskCi,
  updateLinkedTasksFromGitHub,
} from '@/lib/github-db';
import { canUserManageGitHubInstallation } from '@/lib/github-access';
import { githubApiRequest } from '@/lib/github';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import { configureEnvironment, seedProject } from './support/fixtures';
import { seedTask } from './support/fixtures';

describe('GitHub installation boundaries', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it('hides and deselects repositories removed from an installation', async () => {
    const installation = {
      id: 77,
      account: { id: 88, login: 'xapi-labs', type: 'Organization' },
      repository_selection: 'selected',
      html_url: 'https://github.com/settings/installations/77',
    };
    const repository = (id: number, name: string) => ({
      id,
      name,
      full_name: `xapi-labs/${name}`,
      html_url: `https://github.com/xapi-labs/${name}`,
      default_branch: 'main',
      private: true,
    });

    await saveGitHubInstallation('project-1', 'user-1', installation, [
      repository(1, 'kept'),
      repository(2, 'revoked'),
    ]);
    await saveGitHubInstallation('project-1', 'user-1', installation, [
      repository(1, 'kept'),
    ]);
    const settings = await projectGitHubSettings('project-1');

    expect(settings?.repositories.map((item) => item.fullName)).toEqual([
      'xapi-labs/kept',
    ]);
    const staleSelection = database.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM github_project_repositories WHERE project_id = 'project-1' AND repository_id = '2'",
      )
      .get() as { count: number };
    expect(Number(staleSelection.count)).toBe(0);
  });

  it('accepts only personal or administered organization installations', () => {
    const user = { id: '42', githubAdminAccountIds: ['42', '88'] };
    const installation = (id: number, type: string) => ({
      id: 77,
      account: { id, login: `account-${id}`, type },
      repository_selection: 'selected',
    });

    expect(
      canUserManageGitHubInstallation(user, installation(42, 'User')),
    ).toBe(true);
    expect(
      canUserManageGitHubInstallation(user, installation(88, 'Organization')),
    ).toBe(true);
    expect(
      canUserManageGitHubInstallation(user, installation(99, 'Organization')),
    ).toBe(false);
  });

  it('refuses to forward GitHub credentials across redirects or origins', () => {
    const request = githubApiRequest('/user', 'installation-token');
    expect(request.url).toBe('https://api.github.com/user');
    expect(request.redirect).toBe('error');
    expect(request.headers.get('authorization')).toBe(
      'Bearer installation-token',
    );
    for (const path of [
      'https://evil.test/user',
      '//evil.test/user',
      '/\\evil',
    ]) {
      expect(() => githubApiRequest(path, 'installation-token')).toThrow(
        'Invalid GitHub API path',
      );
    }
  });

  it('lets only the first webhook delivery execute', async () => {
    const [first, replay] = await Promise.all([
      startGitHubDelivery('delivery-1', 'push'),
      startGitHubDelivery('delivery-1', 'push'),
    ]);

    expect([first, replay].filter(Boolean)).toHaveLength(1);
  });

  it('records one task-specific event for a replayed linked GitHub update', async () => {
    const task = seedTask(database, { id: 'task-github-activity' });
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO github_installations
         (id, account_id, account_login, account_type, repository_selection, html_url, created_at, updated_at)
         VALUES ('installation-1', '88', 'xapi-labs', 'Organization', 'selected', NULL, ?, ?)`,
      )
      .run(now, now);
    database.sqlite
      .prepare(
        `INSERT INTO github_repositories
         (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
         VALUES ('repository-1', 'installation-1', 'kanby', 'xapi-labs/kanby', 'https://github.com/xapi-labs/kanby', 'main', 1, 1, ?)`,
      )
      .run(now);
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
         VALUES (?, 'project-1', 'repository-1', 'pull_request', 32, 'activity-timeline', 'https://github.com/xapi-labs/kanby/pull/32', 'Timeline', 'open', NULL, ?)`,
      )
      .run(task.id, now);

    const update = () =>
      updateLinkedTasksFromGitHub({
        repositoryId: 'repository-1',
        kind: 'pull_request',
        number: 32,
        title: 'Timeline ready',
        state: 'open',
        url: 'https://github.com/xapi-labs/kanby/pull/32',
        branch: 'activity-timeline',
        targetStatus: 'building',
        activity: {
          deliveryId: 'delivery-linked-pr',
          action: 'opened',
          actorLogin: 'alice',
          actorAvatarUrl: 'https://avatars.test/alice.png',
          summary: 'xapi-labs/kanby #32 · opened',
        },
      });
    await update();
    await update();

    const events = database.sqlite
      .prepare(
        "SELECT kind, actor_login, body FROM task_events WHERE task_id = ? AND source = 'github'",
      )
      .all(task.id) as {
      kind: string;
      actor_login: string;
      body: string | null;
    }[];
    expect(events).toEqual([
      {
        kind: 'github.pull_request.opened',
        actor_login: 'alice',
        body: 'xapi-labs/kanby #32 · opened',
      },
    ]);
  });

  it('routes Push activity only to tasks linked to the pushed branch', async () => {
    const linked = seedTask(database, { id: 'task-linked-push' });
    const unrelated = seedTask(database, { id: 'task-unrelated-push' });
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO github_repositories
         (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
         VALUES ('repository-push', 'installation-push', 'kanby', 'xapi-labs/kanby', 'https://github.com/xapi-labs/kanby', 'main', 1, 1, ?)`,
      )
      .run(now);
    const insertLink = database.sqlite.prepare(
      `INSERT INTO github_task_links
       (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
       VALUES (?, 'project-1', 'repository-push', 'pull_request', ?, ?, ?, ?, 'open', NULL, ?)`,
    );
    insertLink.run(
      linked.id,
      41,
      'activity-timeline',
      'https://github.com/xapi-labs/kanby/pull/41',
      'Activity timeline',
      now,
    );
    insertLink.run(
      unrelated.id,
      42,
      'other-branch',
      'https://github.com/xapi-labs/kanby/pull/42',
      'Other work',
      now,
    );

    await recordLinkedTaskPush('repository-push', 'activity-timeline', {
      deliveryId: 'delivery-push-linked',
      action: 'pushed',
      actorLogin: 'alice',
      actorAvatarUrl: null,
      summary: 'xapi-labs/kanby · activity-timeline',
    });

    const events = database.sqlite
      .prepare(
        "SELECT task_id FROM task_events WHERE source = 'github' AND kind = 'github.push'",
      )
      .all() as { task_id: string }[];
    expect(events).toEqual([{ task_id: linked.id }]);
  });

  it('coalesces replayed CI updates on a linked Pull Request', async () => {
    const task = seedTask(database, { id: 'task-linked-ci' });
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO github_repositories
         (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
         VALUES ('repository-ci', 'installation-ci', 'kanby', 'xapi-labs/kanby', 'https://github.com/xapi-labs/kanby', 'main', 1, 1, ?)`,
      )
      .run(now);
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
         VALUES (?, 'project-1', 'repository-ci', 'pull_request', 51, 'ci-branch', 'https://github.com/xapi-labs/kanby/pull/51', 'CI work', 'open', NULL, ?)`,
      )
      .run(task.id, now);
    const activity = {
      deliveryId: 'delivery-ci-linked',
      action: 'completed',
      actorLogin: 'github-actions',
      actorAvatarUrl: null,
      summary: 'xapi-labs/kanby · ci-branch · success',
    };

    await updateLinkedTaskCi('repository-ci', 'ci-branch', 'success', activity);
    await updateLinkedTaskCi('repository-ci', 'ci-branch', 'success', activity);

    const events = database.sqlite
      .prepare(
        "SELECT kind, body FROM task_events WHERE task_id = ? AND source = 'github'",
      )
      .all(task.id) as { kind: string; body: string | null }[];
    expect(events).toEqual([
      {
        kind: 'github.ci.success',
        body: 'xapi-labs/kanby · ci-branch · success',
      },
    ]);
  });
});
