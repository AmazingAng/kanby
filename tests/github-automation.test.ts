import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH as patchGitHubSettings } from '@/app/api/github/route';
import { POST as importIssue } from '@/app/api/github/issue-task/route';
import { DELETE as unlinkItem } from '@/app/api/github/task-link/route';
import { POST as githubWebhook } from '@/app/api/github/webhook/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import * as github from '@/lib/github';
import {
  DEFAULT_GITHUB_AUTOMATION,
  extractKanbyTaskReference,
  getProjectGitHubAutomation,
  importGitHubIssueTask,
  isFailingCiStatus,
  setProjectGitHubAutomation,
} from '@/lib/github-automation';

import {
  applyMigrations,
  createMigratedDatabase,
  TestD1Database,
} from './support/d1';
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
  number?: number;
  at?: string;
  base?: string;
}) {
  return {
    action: input.action,
    installation: { id: 77 },
    repository: { id: 1, full_name: 'xapi-labs/kanby' },
    sender: { login: 'alice', avatar_url: 'https://avatars.test/alice.png' },
    pull_request: {
      number: input.number ?? 42,
      title: 'Ship GitHub automation',
      body: input.taskReference
        ? `Implements the rules.\n\nKanby-Task: ${input.taskReference}`
        : 'No task marker',
      html_url: `https://github.com/xapi-labs/kanby/pull/${input.number ?? 42}`,
      state: input.action === 'closed' ? 'closed' : 'open',
      merged: input.merged ?? false,
      updated_at: input.at,
      merged_at: input.merged ? input.at : undefined,
      base: { ref: input.base ?? 'main' },
      user: { id: 123 },
      head: {
        ref: input.branch ?? 'github-automation',
        repo: { id: input.headRepositoryId ?? 1 },
      },
    },
  };
}

it('upgrades a database with an imported Issue whose only visible link was replaced by a PR', () => {
  const legacy = new TestD1Database();
  try {
    applyMigrations(legacy, 20);
    seedProject(legacy);
    seedGitHub(legacy);
    const task = seedTask(legacy, { id: 'legacy-delivery-task' });
    legacy.sqlite
      .prepare(`INSERT INTO github_task_links VALUES (?, 'project-1', '1', 'pull_request', 42,
      'work', 'https://github.com/xapi-labs/kanby/pull/42', 'Legacy PR', 'open', 'failure', 1)`)
      .run(task.id);
    legacy.sqlite
      .prepare(`INSERT INTO github_issue_imports
      (id, project_id, repository_id, item_number, task_id, created_by, created_at)
      VALUES ('legacy-import', 'project-1', '1', 9, ?, 'user-1', 1)`)
      .run(task.id);
    const migration = readFileSync(
      'drizzle/0021_github_delivery_pilot.sql',
      'utf8',
    );
    legacy.exec(`BEGIN; ${migration} COMMIT;`);
    expect(
      legacy.sqlite
        .prepare(
          'SELECT kind, item_number, ci_status FROM github_task_links WHERE task_id = ? ORDER BY kind',
        )
        .all(task.id),
    ).toEqual([
      { kind: 'issue', item_number: 9, ci_status: null },
      { kind: 'pull_request', item_number: 42, ci_status: 'failure' },
    ]);
    expect(
      legacy.sqlite
        .prepare('SELECT COUNT(*) AS count FROM github_delivery_repositories')
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    legacy.close();
  }
});

describe('project GitHub automation', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedGitHub(database);
  });

  afterEach(() => database.close());

  it('keeps a pilot card open when its only PR merges into a feature branch', async () => {
    const task = seedTask(database, { id: 'pilot-nondefault-task' });
    database.sqlite
      .prepare(
        "INSERT INTO github_delivery_repositories VALUES ('project-1', '1')",
      )
      .run();
    database.sqlite
      .prepare(`INSERT INTO github_task_links VALUES (?, 'project-1', '1', 'pull_request', 42,
      'work', 'https://github.com/xapi-labs/kanby/pull/42', 'Non-default PR', 'open', NULL, 1)`)
      .run(task.id);
    const response = await signedWebhook(
      'pull_request',
      'pilot-nondefault-merge',
      pullRequestPayload({
        action: 'closed',
        merged: true,
        base: 'feature',
        at: '2026-01-01T10:02:00Z',
      }),
    );
    expect(response.status).toBe(200);
    expect(
      database.sqlite
        .prepare('SELECT status, turn_reason FROM tasks WHERE id = ?')
        .get(task.id),
    ).toEqual({ status: 'ideas', turn_reason: null });
    expect(
      database.sqlite
        .prepare('SELECT state FROM github_task_links WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ state: 'merged' });
  });

  it('removes only the selected URL from a card with an Issue and two PRs', async () => {
    const task = seedTask(database, { id: 'delivery-related-links' });
    const add = database.sqlite.prepare(`INSERT INTO github_task_links VALUES
      (?, 'project-1', '1', ?, ?, NULL, ?, 'Related item', 'open', NULL, 1)`);
    const originRepo = 'https://github.com/xapi-labs/kanby';
    add.run(task.id, 'issue', 2, `${originRepo}/issues/2`);
    add.run(task.id, 'pull_request', 9, `${originRepo}/pull/9`);
    add.run(task.id, 'pull_request', 8, `${originRepo}/pull/8`);
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const response = await unlinkItem(
      new Request(`${origin}/api/github/task-link`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          taskId: task.id,
          url: `${originRepo}/pull/9`,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const { links } = (await response.json()) as {
      links: Array<{ number: number }>;
    };
    expect(links.map((link) => link.number)).toEqual([8, 2]);
  });

  it('imports an Issue URL through the selected installation and reuses the same card from activity', async () => {
    const app = vi.spyOn(github, 'getGitHubAppConfig').mockReturnValue({
      appId: '77',
      slug: 'kanby',
      privateKey: '',
      webhookSecret: '',
    });
    const get = vi.spyOn(github, 'getGitHubLinkedItem').mockResolvedValue({
      kind: 'issue',
      number: 51,
      title: 'A new Issue',
      state: 'open',
      url: 'https://github.com/xapi-labs/kanby/issues/51',
      branch: null,
      merged: false,
    });
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const request = (item: { url: string } | { eventId: string }) =>
      new Request(`${origin}/api/github/issue-task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({ projectId: 'project-1', ...item }),
      });
    try {
      expect(
        (
          await importIssue(
            request({ url: 'https://github.com/other/repo/issues/51' }),
          )
        ).status,
      ).toBe(404);
      expect(get).not.toHaveBeenCalled();
      const created = await importIssue(
        request({ url: 'https://github.com/xapi-labs/kanby/issues/51' }),
      );
      expect(created.status).toBe(201);
      expect(get).toHaveBeenCalledWith(
        expect.anything(),
        '77',
        'xapi-labs/kanby',
        'issue',
        51,
      );
      const { task } = (await created.json()) as {
        task: { id: string; githubLinks: { number: number }[] };
      };
      expect(task.githubLinks.map((link) => link.number)).toEqual([51]);
      database.exec(`INSERT INTO github_events (id, project_id, repository_id, kind, action, item_number, title, summary, url, actor_login, created_at)
        VALUES ('issue-url-event', 'project-1', '1', 'issues', 'opened', 51, 'A new Issue', 'Issue', 'https://github.com/xapi-labs/kanby/issues/51', 'alice', 1)`);
      const existing = await importIssue(
        request({ eventId: 'issue-url-event' }),
      );
      expect(existing.status).toBe(200);
      expect(await existing.json()).toMatchObject({
        task: { id: task.id },
        created: false,
      });
    } finally {
      get.mockRestore();
      app.mockRestore();
    }
  });

  it('hands review and changes to the right people and waits for both PRs before acceptance', async () => {
    const task = seedTask(database, { id: '12345678-pilot' });
    database.exec(`
      INSERT INTO users VALUES ('123', 'developer', 'Developer', NULL, 1, 1),
                               ('234', 'reviewer', 'Reviewer', NULL, 1, 1);
      INSERT INTO project_members VALUES ('project-1', '123', 'member', 1),
                                         ('project-1', '234', 'member', 1);
    `);
    const ownerSession = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const settings = await patchGitHubSettings(
      new Request(`${origin}/api/github`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${ownerSession}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          deliveryRepositoryId: '1',
        }),
      }),
    );
    expect(settings.status).toBe(200);
    const getTurn = () =>
      database.sqlite
        .prepare(
          'SELECT status, turn_user_id, turn_reason FROM tasks WHERE id = ?',
        )
        .get(task.id);
    for (const number of [42, 43]) {
      const response = await signedWebhook(
        'pull_request',
        `pilot-open-${number}`,
        pullRequestPayload({
          action: 'opened',
          taskReference: '12345678',
          number,
        }),
      );
      expect(response.status).toBe(200);
    }
    const reviewRequest = {
      ...pullRequestPayload({
        action: 'review_requested',
        at: '2026-01-01T10:00:00Z',
      }),
      requested_reviewer: { id: 234 },
    };
    await signedWebhook('pull_request', 'pilot-unmapped-review', {
      ...reviewRequest,
      requested_reviewer: { id: 999 },
    });
    expect(getTurn()).toEqual({
      status: 'building',
      turn_user_id: null,
      turn_reason: null,
    });
    await signedWebhook('pull_request', 'pilot-review', reviewRequest);
    expect(getTurn()).toEqual({
      status: 'building',
      turn_user_id: '234',
      turn_reason: 'awaiting_review',
    });
    await signedWebhook('pull_request_review', 'pilot-foreign-changes', {
      ...pullRequestPayload({ action: 'submitted' }),
      review: {
        state: 'changes_requested',
        submitted_at: '2026-01-01T10:00:30Z',
        user: { id: 999 },
      },
    });
    expect(getTurn()).toMatchObject({
      turn_user_id: '234',
      turn_reason: 'awaiting_review',
    });
    await signedWebhook('pull_request_review', 'pilot-changes', {
      ...pullRequestPayload({ action: 'submitted' }),
      review: {
        state: 'changes_requested',
        submitted_at: '2026-01-01T10:01:00Z',
        user: { id: 234 },
      },
    });
    await signedWebhook('pull_request', 'pilot-old-review', reviewRequest);
    expect(getTurn()).toEqual({
      status: 'building',
      turn_user_id: '123',
      turn_reason: 'developing',
    });
    await signedWebhook(
      'pull_request',
      'pilot-first-merge',
      pullRequestPayload({
        action: 'closed',
        merged: true,
        at: '2026-01-01T10:02:00Z',
      }),
    );
    expect(getTurn()).toEqual({
      status: 'building',
      turn_user_id: '123',
      turn_reason: 'developing',
    });
    await signedWebhook(
      'pull_request',
      'pilot-last-merge',
      pullRequestPayload({
        action: 'closed',
        merged: true,
        number: 43,
        base: 'feature',
        at: '2026-01-01T10:03:00Z',
      }),
    );
    expect(getTurn()).toEqual({
      status: 'building',
      turn_user_id: 'user-1',
      turn_reason: 'awaiting_acceptance',
    });
    await signedWebhook(
      'pull_request',
      'pilot-last-merge',
      pullRequestPayload({
        action: 'closed',
        merged: true,
        number: 43,
        base: 'feature',
        at: '2026-01-01T10:03:00Z',
      }),
    );
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = 'github.turn.awaiting_acceptance'",
        )
        .get(task.id),
    ).toEqual({ count: 1 });
    database.exec(`UPDATE tasks SET turn_kind = NULL, turn_user_id = NULL, turn_reason = NULL, turn_since = NULL WHERE id = '12345678-pilot';
      INSERT INTO task_events (id, project_id, task_id, source, kind, actor_name, summary, created_at)
      VALUES ('manual-clear', 'project-1', '12345678-pilot', 'user', 'turn.changed', 'Alice', 'Cleared', 1767261900000);`);
    await signedWebhook(
      'pull_request',
      'pilot-late-merge',
      pullRequestPayload({
        action: 'closed',
        merged: true,
        number: 43,
        base: 'feature',
        at: '2026-01-01T10:03:00Z',
      }),
    );
    expect(getTurn()).toMatchObject({ turn_reason: null });
  });

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
    database.exec(`UPDATE tasks SET task_number = 7 WHERE project_id IN ('project-1', 'project-2');
      INSERT INTO github_project_installations (project_id, installation_id, connected_by, created_at)
      VALUES ('project-2', '77', 'user-1', 1);`);
    await signedWebhook(
      'pull_request',
      'delivery-ambiguous-number',
      pullRequestPayload({ action: 'opened', taskReference: 'KANBY-7' }),
    );
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM github_task_links')
        .get(),
    ).toEqual({ count: 0 });
    await signedWebhook(
      'pull_request',
      'delivery-qualified-number',
      pullRequestPayload({
        action: 'opened',
        taskReference: 'project-two/KANBY-7',
      }),
    );
    expect(
      database.sqlite
        .prepare('SELECT project_id, task_id FROM github_task_links')
        .all(),
    ).toEqual([
      {
        project_id: 'project-2',
        task_id: 'feedbeef-2222-4222-8222-222222222222',
      },
    ]);
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

  it('keeps the imported Issue and its completion association after linking a PR', async () => {
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
        .prepare(
          'SELECT kind FROM github_task_links WHERE task_id = ? ORDER BY kind',
        )
        .all(imported.task.id),
    ).toEqual([{ kind: 'issue' }, { kind: 'pull_request' }]);

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
        .prepare(
          'SELECT kind, state FROM github_task_links WHERE task_id = ? ORDER BY kind',
        )
        .all(imported.task.id),
    ).toEqual([
      { kind: 'issue', state: 'closed' },
      { kind: 'pull_request', state: 'open' },
    ]);
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
