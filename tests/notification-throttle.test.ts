import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATION_COALESCE_MS,
  NOTIFICATION_HOURLY_CAP,
  sendMemberNotice,
  sendTaskNotification,
  type TaskNotification,
} from '@/lib/notifications';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import { configureEnvironment, seedProject } from './support/fixtures';

const wecomUrl =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh-1234';

function event(taskId = 'task-1'): TaskNotification {
  return {
    projectId: 'project-1',
    projectSlug: 'project-one',
    taskId,
    taskRef: 'KANBY-1',
    taskTitle: 'Title',
    kind: 'turn.changed',
    actorName: 'Bob',
    recipients: [{ userId: 'user-1', name: 'Alice' }],
    reasonLabel: null,
    note: null,
  };
}

function deliveries(database: TestD1Database) {
  return database.sqlite
    .prepare(
      'SELECT task_id, status, error, recipient_key FROM notification_deliveries ORDER BY created_at, rowid',
    )
    .all() as {
    task_id: string | null;
    status: string;
    error: string | null;
    recipient_key: string;
  }[];
}

describe('notification rate limiting', () => {
  let database: TestD1Database;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    database.sqlite
      .prepare(
        `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
         VALUES ('alice-bot', 'project-1', 'user-1', 'wecom', ?, NULL, 1, 'user-1', 1, 1)`,
      )
      .run(wecomUrl);
    fetchMock = vi.fn(async () => Response.json({ errcode: 0 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    database.close();
  });

  it('coalesces repeated pings about the same card and records the suppression', async () => {
    await sendTaskNotification(event());
    await sendTaskNotification(event());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliveries(database)).toEqual([
      {
        task_id: 'task-1',
        status: 'sent',
        error: null,
        recipient_key: 'user:user-1',
      },
      {
        task_id: 'task-1',
        status: 'suppressed',
        error: 'coalesced',
        recipient_key: 'user:user-1',
      },
    ]);

    // Another card is not coalesced, and the same card is again after the window.
    await sendTaskNotification(event('task-2'));
    vi.useFakeTimers({ now: Date.now() + NOTIFICATION_COALESCE_MS + 1 });
    await sendTaskNotification(event());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caps deliveries per recipient per hour', async () => {
    const insert = database.sqlite.prepare(
      `INSERT INTO notification_deliveries (id, project_id, channel_id, task_id, event_kind, status, error, recipient_key, created_at)
       VALUES (?, 'project-1', 'alice-bot', ?, 'turn.changed', 'sent', NULL, 'user:user-1', ?)`,
    );
    for (let index = 0; index < NOTIFICATION_HOURLY_CAP; index += 1)
      insert.run(`old-${index}`, `other-${index}`, Date.now() - 10 * 60_000);

    await sendTaskNotification(event('fresh'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveries(database).at(-1)).toMatchObject({
      status: 'suppressed',
      error: 'hourly_cap',
    });
  });

  it('sends account notices to personal bots once per webhook, unthrottled', async () => {
    database.sqlite
      .prepare(
        `INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES ('project-2', 'Two', 'two', 'user-1', 1, 1)`,
      )
      .run();
    database.sqlite
      .prepare(
        `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
         VALUES ('alice-bot-2', 'project-2', 'user-1', 'wecom', ?, NULL, 1, 'user-1', 2, 2)`,
      )
      .run(wecomUrl);
    await sendMemberNotice('user-1', 'account.mini_linked', 'notice');
    await sendMemberNotice('user-1', 'account.mini_linked', 'notice');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deliveries(database).map((row) => row.status)).toEqual([
      'sent',
      'sent',
    ]);
  });
});
