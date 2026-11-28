import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNotificationChannel,
  deleteNotificationChannel,
  listNotificationChannels,
  sendMemberNotice,
} from '@/lib/notifications';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import { configureEnvironment, seedProject } from './support/fixtures';

const runtime = env as unknown as Record<string, unknown>;
const feishuUrl =
  'https://open.feishu.cn/open-apis/bot/v2/hook/abcdef12-3456-7890-abcd-ef1234567890';

function stored(database: TestD1Database) {
  return database.sqlite
    .prepare('SELECT id, webhook_url, secret FROM notification_channels')
    .all() as { id: string; webhook_url: string; secret: string | null }[];
}

describe('notification channel secrets at rest', () => {
  let database: TestD1Database;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    runtime.WEIXIN_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString('base64');
    fetchMock = vi.fn(async () => Response.json({ code: 0 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    delete runtime.WEIXIN_CREDENTIAL_KEY;
    vi.unstubAllGlobals();
    database.close();
  });

  it('seals webhook URLs and signing secrets and still delivers', async () => {
    await createNotificationChannel({
      projectId: 'project-1',
      userId: 'user-1',
      kind: 'feishu',
      webhookUrl: feishuUrl,
      secret: 'signing-secret',
      createdBy: 'user-1',
    });
    const [row] = stored(database);
    expect(row!.webhook_url).toMatch(/^v1\./);
    expect(row!.secret).toMatch(/^v1\./);
    expect(JSON.stringify(stored(database))).not.toContain('abcdef12');
    expect(JSON.stringify(stored(database))).not.toContain('signing-secret');

    const [listed] = await listNotificationChannels('project-1', 'user-1');
    expect(listed).toMatchObject({
      target: 'open.feishu.cn …7890',
      signed: true,
    });

    await sendMemberNotice('user-1', 'test', 'hello');
    expect(fetchMock.mock.calls[0]![0]).toBe(feishuUrl);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    ) as { sign?: string };
    expect(body.sign).toBeTypeOf('string');
  });

  it('re-seals legacy plaintext rows on read and skips undecryptable rows', async () => {
    database.sqlite
      .prepare(
        `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
         VALUES ('legacy', 'project-1', 'user-1', 'feishu', ?, 'plain-secret', 1, 'user-1', 1, 1)`,
      )
      .run(feishuUrl);
    await listNotificationChannels('project-1', 'user-1');
    const [row] = stored(database);
    expect(row!.webhook_url).toMatch(/^v1\./);
    expect(row!.secret).toMatch(/^v1\./);

    // A different key cannot open the row: it is skipped, nothing is sent.
    runtime.WEIXIN_CREDENTIAL_KEY = Buffer.alloc(32, 9).toString('base64');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [unreadable] = await listNotificationChannels('project-1', 'user-1');
    expect(unreadable).toMatchObject({ id: 'legacy', unreadable: true });
    expect(JSON.stringify(unreadable)).not.toContain('v1.');
    await sendMemberNotice('user-1', 'test', 'hello');
    expect(fetchMock).not.toHaveBeenCalled();
    // It can be deleted, which frees its slot for re-adding the bot.
    expect(
      await deleteNotificationChannel({
        projectId: 'project-1',
        channelId: 'legacy',
        userId: 'user-1',
        isOwner: false,
      }),
    ).toBe(true);
    expect(await listNotificationChannels('project-1', 'user-1')).toEqual([]);
  });

  it('keeps plaintext when no key is configured', async () => {
    delete runtime.WEIXIN_CREDENTIAL_KEY;
    await createNotificationChannel({
      projectId: 'project-1',
      userId: null,
      kind: 'feishu',
      webhookUrl: feishuUrl,
      secret: null,
      createdBy: 'user-1',
    });
    expect(stored(database)[0]).toMatchObject({
      webhook_url: feishuUrl,
      secret: null,
    });
    expect(await listNotificationChannels('project-1', 'user-1')).toHaveLength(
      1,
    );
  });
});
