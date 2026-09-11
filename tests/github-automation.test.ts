import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATCH as patchGitHubSettings } from '@/app/api/github/route';
import { POST as importIssue } from '@/app/api/github/issue-task/route';
import { POST as githubWebhook } from '@/app/api/github/webhook/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  DEFAULT_GITHUB_AUTOMATION,
  extractKanbyTaskReference,
  getProjectGitHubAutomation,
  importGitHubIssueTask,
  isFailingCiStatus,
  setProjectGitHubAutomation,
} from '@/lib/github-automation';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

function seedGitHub(database: TestD1Database) {
  const now = 1_700_000_000_000;
  database.sqlite
    .prepare(
      `INSERT INTO github_installations
       (id, account_id, account_login, account_type, repository_selection, html_url, created_at, updated_at)
       VALUES ('77', '88', 'xapi-labs', 'Organization', 'selected', NULL, ?, ?)`,
    )
    .run(now, now);
  database.sqlite
    .prepare(
      `INSERT INTO github_project_installations
       (project_id, installation_id, connected_by, created_at)
       VALUES ('project-1', '77', 'user-1', ?)`,
    )
    .run(now);
  database.sqlite
    .prepare(
      `INSERT INTO github_repositories
       (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
       VALUES ('1', '77', 'kanby', 'xapi-labs/kanby', 'https://github.com/xapi-labs/kanby', 'main', 1, 1, ?)`,
    )
    .run(now);
  database.sqlite
    .prepare(
      `INSERT INTO github_project_repositories
       (project_id, repository_id, created_at) VALUES ('project-1', '1', ?)`,
    )
    .run(now);
}

async function signedWebhook(
  event: string,
  delivery: string,
  payload: Record<string, unknown>,
) {
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-webhook-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  return githubWebhook(
    new Request(`${origin}/api/github/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256': `sha256=${signature}`,
      },
      body: raw,
    }),
  );
}

function pullRequestPayload(input: {
  action: string;
  taskReference?: string;
  merged?: boolean;
  branch?: string;
  headRepositoryId?: number;
}) {
  return {
    action: input.action,
    installation: { id: 77 },
    repository: { id: 1, full_name: 'xapi-labs/kanby' },
    sender: { login: 'alice', avatar_url: 'https://avatars.test/alice.png' },
    pull_request: {
      number: 42,
      title: 'Ship GitHub automation',
      body: input.taskReference
        ? `Implements the rules.\n\nKanby-Task: ${input.taskReference}`
        : 'No task marker',
      html_url: 'https://github.com/xapi-labs/kanby/pull/42',
      state: input.action === 'closed' ? 'closed' : 'open',
      merged: input.merged ?? false,
      head: {
        ref: input.branch ?? 'github-automation',
        repo: { id: input.headRepositoryId ?? 1 },
      },
    },
  };
}

describe('project GitHub automation', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedGitHub(database);
  });

  afterEach(() => database.close());

  it('provides defaults and lets only the owner persist adjusted rules', async () => {
    expect(await getProjectGitHubAutomation('project-1')).toEqual(
      DEFAULT_GITHUB_AUTOMATION,
    );
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const automation = {
      issueTaskCreation: false,
      autoLinkPullRequests: false,
      pullRequestOpenStatus: 'ideas',
      completionStatus: null,
      showCiFailures: false,
    } as const;
    const response = await patchGitHubSettings(
      new Request(`${origin}/api/github`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({ projectId: 'project-1', automation }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      connection: { automation: typeof automation };
    };
    expect(payload.connection.automation).toEqual(automation);
    expect(await getProjectGitHubAutomation('project-1')).toEqual(automation);

    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO users (id, login, name, avatar_url, created_at, updated_at)
         VALUES ('user-2', 'bob', 'Bob', NULL, ?, ?)`,
      )
      .run(now, now);
    database.sqlite
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role, created_at)
         VALUES ('project-1', 'user-2', 'member', ?)`,
      )
      .run(now);
    const memberSession = await createSessionToken(
      { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
      sessionSecret,
    );
    const denied = await patchGitHubSettings(
      new Request(`${origin}/api/github`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${memberSession}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          automation: DEFAULT_GITHUB_AUTOMATION,
        }),
      }),
    );
    expect(denied.status).toBe(403);
    expect(await getProjectGitHubAutomation('project-1')).toEqual(automation);
  });

  it('extracts only explicit full/ref trailers or kanby branches', () => {
    expect(
      extractKanbyTaskReference({
        body: 'Summary\n\nKanby-Task: ABCDEF12',
        branch: 'feature/no-match',
      }),
    ).toBe('abcdef12');
    expect(
      extractKanbyTaskReference({
        body: '',
        branch: 'kanby/12345678-ci-warning',
      }),
    ).toBe('12345678');
    expect(
      extractKanbyTaskReference({
        body: 'Fixes issue 12345678',
        branch: 'feature/12345678',
      }),
    ).toBeNull();
    expect(
      extractKanbyTaskReference({ body: 'Kanby-Task: short', branch: '' }),
    ).toBeNull();
  });

  it('imports one selected Issue exactly once and links the created task', async () => {
    database.sqlite
      .prepare(
        `INSERT INTO github_events
         (id, project_id, repository_id, kind, action, item_number, title, summary, url, actor_login, actor_avatar_url, created_at)
         VALUES ('issue-event', 'project-1', '1', 'issues', 'opened', 17, 'Fix mobile drag', 'xapi-labs/kanby #17 · opened', 'https://github.com/xapi-labs/kanby/issues/17', 'alice', NULL, ?)`,
      )
      .run(Date.now());
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const request = () =>
      new Request(`${origin}/api/github/issue-task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          eventId: 'issue-event',
        }),
      });
    const responses = await Promise.all([
      importIssue(request()),
      importIssue(request()),
    ]);
    const payloads = (await Promise.all(
      responses.map((response) => response.json()),
    )) as { task: { id: string } }[];
    const firstPayload = payloads[0];

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 201]);
    expect(payloads[1].task.id).toBe(firstPayload.task.id);
    expect(
      database.sqlite
        .prepare(
          `SELECT title, note, status, owner_login FROM tasks
           WHERE id = ?`,
        )
        .get(firstPayload.task.id),
    ).toEqual({
      title: 'Fix mobile drag',
      note: 'https://github.com/xapi-labs/kanby/issues/17',
      status: 'ideas',
      owner_login: 'alice',
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT kind, item_number FROM github_task_links WHERE task_id = ?`,
        )
        .get(firstPayload.task.id),
    ).toEqual({ kind: 'issue', item_number: 17 });
    expect(
      database.sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM tasks WHERE project_id = 'project-1' AND title = 'Fix mobile drag'`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('reuses a task already linked to the Issue instead of duplicating it', async () => {
    const task = seedTask(database, { id: 'task-existing-issue' });
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
         VALUES (?, 'project-1', '1', 'issue', 19, NULL, 'https://github.com/xapi-labs/kanby/issues/19', 'Existing issue', 'open', NULL, ?)`,
      )
      .run(task.id, now);
    database.sqlite
      .prepare(
        `INSERT INTO github_events
         (id, project_id, repository_id, kind, action, item_number, title, summary, url, actor_login, actor_avatar_url, created_at)
         VALUES ('existing-issue-event', 'project-1', '1', 'issues', 'opened', 19, 'Existing issue', 'issue', 'https://github.com/xapi-labs/kanby/issues/19', 'alice', NULL, ?)`,
      )
      .run(now);

    const result = await importGitHubIssueTask(
      'project-1',
      'existing-issue-event',
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
    );
    expect(result && result !== 'disabled' ? result.task.id : null).toBe(
      task.id,
    );
    expect(result && result !== 'disabled' ? result.created : null).toBe(false);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM tasks WHERE project_id = 'project-1'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('blocks Issue import when its project rule is disabled', async () => {
    await setProjectGitHubAutomation('project-1', 'user-1', {
      ...DEFAULT_GITHUB_AUTOMATION,
      issueTaskCreation: false,
    });
    database.sqlite
      .prepare(
        `INSERT INTO github_events
         (id, project_id, repository_id, kind, action, item_number, title, summary, url, actor_login, actor_avatar_url, created_at)
         VALUES ('disabled-issue', 'project-1', '1', 'issues', 'opened', 18, 'Do not import', 'issue', 'https://github.com/xapi-labs/kanby/issues/18', 'alice', NULL, ?)`,
      )
      .run(Date.now());
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const response = await importIssue(
      new Request(`${origin}/api/github/issue-task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          eventId: 'disabled-issue',
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM tasks WHERE title = 'Do not import'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('rejects hostile settings and cross-origin Issue imports', async () => {
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const invalidSettings = await patchGitHubSettings(
      new Request(`${origin}/api/github`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          automation: {
            ...DEFAULT_GITHUB_AUTOMATION,
            completionStatus: 'deleted',
          },
        }),
      }),
    );
    expect(invalidSettings.status).toBe(400);
    expect(await getProjectGitHubAutomation('project-1')).toEqual(
      DEFAULT_GITHUB_AUTOMATION,
    );

    const forgedImport = await importIssue(
      new Request(`${origin}/api/github/issue-task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: 'https://evil.test',
        },
        body: JSON.stringify({
          projectId: 'project-1',
          eventId: 'missing',
        }),
      }),
    );
    expect(forgedImport.status).toBe(403);
  });

  it('auto-links a marked PR and moves only unfinished work to building', async () => {
    const task = seedTask(database, {
      id: 'abcdef12-1234-4234-8234-abcdef123456',
    });
    const opened = await signedWebhook(
      'pull_request',
      'delivery-pr-opened',
      pullRequestPayload({ action: 'opened', taskReference: 'ABCDEF12' }),
    );
    expect(opened.status).toBe(200);
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'building' });
    expect(
      database.sqlite
        .prepare(
          'SELECT kind, item_number, branch FROM github_task_links WHERE task_id = ?',
        )
        .get(task.id),
    ).toEqual({
      kind: 'pull_request',
      item_number: 42,
      branch: 'github-automation',
    });

    const shipped = seedTask(database, {
      id: '12345678-1234-4234-8234-abcdef123456',
    });
    database.sqlite
      .prepare("UPDATE tasks SET status = 'shipped' WHERE id = ?")
      .run(shipped.id);
    await signedWebhook(
      'pull_request',
      'delivery-pr-opened-shipped',
      pullRequestPayload({ action: 'opened', taskReference: '12345678' }),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(shipped.id),
    ).toEqual({ status: 'shipped' });
  });

  it('does not auto-link an ambiguous short task reference across projects', async () => {
    seedTask(database, { id: 'feedbeef-1111-4111-8111-111111111111' });
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at)
         VALUES ('project-2', 'Project Two', 'project-two', 'user-1', ?, ?)`,
      )
      .run(now, now);
    database.sqlite
      .prepare(
        `INSERT INTO github_project_repositories (project_id, repository_id, created_at)
         VALUES ('project-2', '1', ?)`,
      )
      .run(now);
    database.sqlite
      .prepare(
        `INSERT INTO tasks
         (id, project_id, title, note, tag, owner_id, owner_login, owner_name,
          owner_avatar_url, due, status, position, created_at, updated_at, archived_at, created_by)
         VALUES ('feedbeef-2222-4222-8222-222222222222', 'project-2', 'Collision', '', '代码',
                 'user-1', 'alice', 'Alice', NULL, NULL, 'ideas', 0, ?, ?, NULL, 'user-1')`,
      )
      .run(now, now);

    await signedWebhook(
      'pull_request',
      'delivery-ambiguous-pr',
      pullRequestPayload({ action: 'opened', taskReference: 'feedbeef' }),
    );
    expect(
      database.sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM github_task_links WHERE item_number = 42`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('does not auto-link a marked PR when that project rule is off', async () => {
    const task = seedTask(database, {
      id: 'deadbeef-1234-4234-8234-abcdef123456',
    });
    await setProjectGitHubAutomation('project-1', 'user-1', {
      ...DEFAULT_GITHUB_AUTOMATION,
      autoLinkPullRequests: false,
    });
    await signedWebhook(
      'pull_request',
      'delivery-disabled-pr-link',
      pullRequestPayload({ action: 'opened', taskReference: 'deadbeef' }),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'ideas' });
    expect(
      database.sqlite
        .prepare(
          'SELECT COUNT(*) AS count FROM github_task_links WHERE task_id = ?',
        )
        .get(task.id),
    ).toEqual({ count: 0 });
  });

  it('does not auto-link a marked Pull Request submitted from a fork', async () => {
    const task = seedTask(database, {
      id: 'badc0ffe-1234-4234-8234-abcdef123456',
    });
    await signedWebhook(
      'pull_request',
      'delivery-fork-pr',
      pullRequestPayload({
        action: 'opened',
        taskReference: 'badc0ffe',
        headRepositoryId: 999,
      }),
    );
    expect(
      database.sqlite
        .prepare(
          'SELECT COUNT(*) AS count FROM github_task_links WHERE task_id = ?',
        )
        .get(task.id),
    ).toEqual({ count: 0 });
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'ideas' });
  });

  it('honors adjusted PR/open and completion targets without completing an unmerged PR', async () => {
    const task = seedTask(database, {
      id: '87654321-1234-4234-8234-abcdef123456',
    });
    await setProjectGitHubAutomation('project-1', 'user-1', {
      ...DEFAULT_GITHUB_AUTOMATION,
      pullRequestOpenStatus: 'ideas',
      completionStatus: 'building',
    });
    await signedWebhook(
      'pull_request',
      'delivery-custom-open',
      pullRequestPayload({ action: 'opened', taskReference: '87654321' }),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'ideas' });

    await signedWebhook(
      'pull_request',
      'delivery-unmerged-close',
      pullRequestPayload({ action: 'closed', merged: false }),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'ideas' });

    await signedWebhook(
      'pull_request',
      'delivery-merged-close',
      pullRequestPayload({ action: 'closed', merged: true }),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'building' });
  });

  it('supports record-only PR and completion rules', async () => {
    const task = seedTask(database, {
      id: 'cafebabe-1234-4234-8234-abcdef123456',
    });
    await setProjectGitHubAutomation('project-1', 'user-1', {
      ...DEFAULT_GITHUB_AUTOMATION,
      pullRequestOpenStatus: null,
      completionStatus: null,
    });
    await signedWebhook(
      'pull_request',
      'delivery-record-only-open',
      pullRequestPayload({ action: 'opened', taskReference: 'cafebabe' }),
    );
    await signedWebhook(
      'pull_request',
      'delivery-record-only-merge',
      pullRequestPayload({ action: 'closed', merged: true }),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'ideas' });
    expect(
      database.sqlite
        .prepare('SELECT state FROM github_task_links WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ state: 'merged' });
  });

  it('moves a closed linked Issue to the configured completion target', async () => {
    const task = seedTask(database, { id: 'task-closed-issue' });
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
         VALUES (?, 'project-1', '1', 'issue', 73, NULL, 'https://github.com/xapi-labs/kanby/issues/73', 'Close me', 'open', NULL, ?)`,
      )
      .run(task.id, Date.now());
    const response = await signedWebhook('issues', 'delivery-issue-closed', {
      action: 'closed',
      installation: { id: 77 },
      repository: { id: 1, full_name: 'xapi-labs/kanby' },
      sender: { login: 'alice' },
      issue: {
        number: 73,
        title: 'Close me',
        html_url: 'https://github.com/xapi-labs/kanby/issues/73',
        state: 'closed',
      },
    });
    expect(response.status).toBe(200);
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'shipped' });
  });

  it('keeps the imported Issue completion association after a PR replaces the visible link', async () => {
    database.sqlite
      .prepare(
        `INSERT INTO github_events
         (id, project_id, repository_id, kind, action, item_number, title, summary, url, actor_login, actor_avatar_url, created_at)
         VALUES ('issue-before-pr', 'project-1', '1', 'issues', 'opened', 74, 'Imported issue', 'issue', 'https://github.com/xapi-labs/kanby/issues/74', 'alice', NULL, ?)`,
      )
      .run(Date.now());
    const imported = await importGitHubIssueTask(
      'project-1',
      'issue-before-pr',
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
    );
    expect(imported && imported !== 'disabled').toBe(true);
    if (!imported || imported === 'disabled') throw new Error('import failed');
    const reference = imported.task.id.slice(0, 8);

    await signedWebhook(
      'pull_request',
      'delivery-pr-after-issue',
      pullRequestPayload({ action: 'opened', taskReference: reference }),
    );
    expect(
      database.sqlite
        .prepare('SELECT kind FROM github_task_links WHERE task_id = ?')
        .get(imported.task.id),
    ).toEqual({ kind: 'pull_request' });

    await signedWebhook('issues', 'delivery-imported-issue-closed', {
      action: 'closed',
      installation: { id: 77 },
      repository: { id: 1, full_name: 'xapi-labs/kanby' },
      sender: { login: 'alice' },
      issue: {
        number: 74,
        title: 'Imported issue',
        html_url: 'https://github.com/xapi-labs/kanby/issues/74',
        state: 'closed',
      },
    });
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(imported.task.id),
    ).toEqual({ status: 'shipped' });
    expect(
      database.sqlite
        .prepare('SELECT kind FROM github_task_links WHERE task_id = ?')
        .get(imported.task.id),
    ).toEqual({ kind: 'pull_request' });
  });

  it('shows a failing CI conclusion without changing workflow status, then clears it', async () => {
    const task = seedTask(database, { id: 'task-ci-automation' });
    database.sqlite
      .prepare("UPDATE tasks SET status = 'building' WHERE id = ?")
      .run(task.id);
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
         VALUES (?, 'project-1', '1', 'pull_request', 55, 'ci-branch', 'https://github.com/xapi-labs/kanby/pull/55', 'CI work', 'open', NULL, ?)`,
      )
      .run(task.id, Date.now());
    const workflow = (conclusion: string) => ({
      action: 'completed',
      installation: { id: 77 },
      repository: { id: 1, full_name: 'xapi-labs/kanby' },
      sender: { login: 'github-actions' },
      workflow_run: {
        name: 'test',
        head_branch: 'ci-branch',
        conclusion,
        status: 'completed',
        html_url: 'https://github.com/xapi-labs/kanby/actions/runs/1',
      },
    });

    await signedWebhook(
      'workflow_run',
      'delivery-ci-fail',
      workflow('failure'),
    );
    expect(
      database.sqlite
        .prepare('SELECT status FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'building' });
    expect(
      database.sqlite
        .prepare('SELECT ci_status FROM github_task_links WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ ci_status: 'failure' });
    expect(isFailingCiStatus('failure')).toBe(true);
    expect(isFailingCiStatus('success')).toBe(false);

    await signedWebhook(
      'workflow_run',
      'delivery-ci-success',
      workflow('success'),
    );
    expect(
      database.sqlite
        .prepare('SELECT ci_status FROM github_task_links WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ ci_status: 'success' });
  });

  it('clears and suppresses task CI state when the project warning rule is off', async () => {
    const task = seedTask(database, { id: 'task-ci-disabled' });
    database.sqlite
      .prepare(
        `INSERT INTO github_task_links
         (task_id, project_id, repository_id, kind, item_number, branch, url, title, state, ci_status, updated_at)
         VALUES (?, 'project-1', '1', 'pull_request', 56, 'ci-off', 'https://github.com/xapi-labs/kanby/pull/56', 'CI disabled', 'open', 'failure', ?)`,
      )
      .run(task.id, Date.now());
    await setProjectGitHubAutomation('project-1', 'user-1', {
      ...DEFAULT_GITHUB_AUTOMATION,
      showCiFailures: false,
    });
    expect(
      database.sqlite
        .prepare('SELECT ci_status FROM github_task_links WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ ci_status: null });

    await signedWebhook('workflow_run', 'delivery-ci-off', {
      action: 'completed',
      installation: { id: 77 },
      repository: { id: 1, full_name: 'xapi-labs/kanby' },
      sender: { login: 'github-actions' },
      workflow_run: {
        name: 'test',
        head_branch: 'ci-off',
        conclusion: 'failure',
        status: 'completed',
        html_url: 'https://github.com/xapi-labs/kanby/actions/runs/2',
      },
    });
    expect(
      database.sqlite
        .prepare('SELECT ci_status FROM github_task_links WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ ci_status: null });
  });
});
