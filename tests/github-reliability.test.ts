import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST as githubWebhook } from '@/app/api/github/webhook/route';

import {
  claimDueGitHubDeliveries,
  failGitHubDelivery,
  finishGitHubDelivery,
  githubRetryDelay,
  startGitHubDelivery,
} from '@/lib/github-db';
import {
  autoLinkPullRequest,
  extractKanbyTaskReference,
} from '@/lib/github-automation';
import { resolveAgentTask } from '@/lib/agent';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  seedProject,
  seedTask,
} from './support/fixtures';

async function webhookSignature(raw: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode('test-webhook-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(raw)),
  );
  return `sha256=${[...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

describe('GitHub automation reliability', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => database.close());

  it('recognizes bounded task keys from branches, PR text, and commits', () => {
    expect(
      extractKanbyTaskReference({ branch: 'feature/KANBY-123-login' }),
    ).toBe('kanby-123');
    expect(extractKanbyTaskReference({ body: 'Closes KANBY-0042.' })).toBe(
      'kanby-42',
    );
    expect(extractKanbyTaskReference({ commits: ['fix: KANBY-9 retry'] })).toBe(
      'kanby-9',
    );
    expect(extractKanbyTaskReference({ body: 'NOTKANBY-12' })).toBeNull();
    expect(extractKanbyTaskReference({ body: 'KANBY-12x' })).toBeNull();
  });

  it('persists failed deliveries and atomically leases due retries', async () => {
    expect(await startGitHubDelivery('guid-1', 'push', '{"ok":true}')).toBe(
      true,
    );
    expect(await startGitHubDelivery('guid-1', 'push', '{"ok":true}')).toBe(
      false,
    );
    await failGitHubDelivery(
      'guid-1',
      new Error('temporary outage\nprivate detail'),
    );
    const failed = database.sqlite
      .prepare(
        'SELECT status, payload, attempt_count, last_error FROM github_deliveries WHERE id = ?',
      )
      .get('guid-1');
    expect(failed).toMatchObject({
      status: 'failed',
      payload: '{"ok":true}',
      attempt_count: 1,
      last_error: 'temporary outage private detail',
    });
    database.sqlite
      .prepare('UPDATE github_deliveries SET next_retry_at = 0 WHERE id = ?')
      .run('guid-1');
    const first = await claimDueGitHubDeliveries();
    const concurrent = await claimDueGitHubDeliveries();
    expect(first).toEqual([
      { id: 'guid-1', event: 'push', payload: '{"ok":true}' },
    ]);
    expect(concurrent).toEqual([]);
    await finishGitHubDelivery('guid-1');
    expect(
      database.sqlite
        .prepare(
          'SELECT status, payload, processed_at FROM github_deliveries WHERE id = ?',
        )
        .get('guid-1'),
    ).toMatchObject({ status: 'complete', payload: null });
  });

  it('uses bounded exponential retry delays', () => {
    expect(githubRetryDelay(1)).toBe(30_000);
    expect(githubRetryDelay(2)).toBe(60_000);
    expect(githubRetryDelay(50)).toBe(6 * 60 * 60 * 1000);
  });

  it('acknowledges a durably queued processing failure', async () => {
    const raw = '{invalid-json';
    const response = await githubWebhook(
      new Request('https://kanby.test/api/github/webhook', {
        method: 'POST',
        headers: {
          'x-github-event': 'push',
          'x-github-delivery': 'malformed-guid',
          'x-hub-signature-256': await webhookSignature(raw),
        },
        body: raw,
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, queued: true });
    expect(
      database.sqlite
        .prepare(
          'SELECT status, payload, last_error FROM github_deliveries WHERE id = ?',
        )
        .get('malformed-guid'),
    ).toMatchObject({ status: 'failed', payload: raw });
  });

  it('resolves and auto-links the project-local KANBY number', async () => {
    database.sqlite.exec(`
      INSERT INTO github_installations
        (id, account_id, account_login, account_type, repository_selection, created_at, updated_at)
      VALUES ('77', '88', 'xapi-labs', 'Organization', 'selected', 1, 1);
      INSERT INTO github_project_installations
        (project_id, installation_id, connected_by, created_at)
      VALUES ('project-1', '77', 'user-1', 1);
      INSERT INTO github_repositories
        (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
      VALUES ('1', '77', 'kanby', 'xapi-labs/kanby', 'https://github.com/xapi-labs/kanby', 'main', 1, 1, 1);
      INSERT INTO github_project_repositories (project_id, repository_id, created_at)
      VALUES ('project-1', '1', 1);
    `);
    const task = seedTask(database, { id: 'task-numbered-0001' });
    database.sqlite
      .prepare('UPDATE tasks SET task_number = 123 WHERE id = ?')
      .run(task.id);
    expect(await resolveAgentTask('project-1', 'KANBY-123')).toBe(task.id);
    const linked = await autoLinkPullRequest({
      repositoryId: '1',
      number: 18,
      title: 'Ship it',
      state: 'open',
      url: 'https://github.com/xapi-labs/kanby/pull/18',
      branch: 'feature/KANBY-123-ship',
      body: '',
      deliveryId: 'numeric-link',
      actorLogin: 'alice',
      actorAvatarUrl: null,
    });
    expect(linked).toBe(1);
    expect(
      database.sqlite
        .prepare('SELECT task_id, item_number FROM github_task_links')
        .get(),
    ).toEqual({ task_id: task.id, item_number: 18 });
  });
});
