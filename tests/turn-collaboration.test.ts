import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELETE as channelsDELETE,
  GET as channelsGET,
  POST as channelsPOST,
} from '@/app/api/notification-channels/route';
import { POST as commentPOST } from '@/app/api/task-events/route';
import { POST as turnPOST } from '@/app/api/task-turn/route';
import { GET as turnsGET } from '@/app/api/turns/route';
import { GET as nextGET } from '@/app/api/v1/next/route';
import { GET as tasksGET, PATCH } from '@/app/api/v1/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  maskWebhookUrl,
  validateWebhookUrl,
  webhookPayload,
} from '@/lib/notifications';
import {
  activityVisibility,
  parseMentions,
  parseTargetSpec,
} from '@/lib/turns';

import { createMigratedDatabase, TestD1Database } from './support/d1';
import {
  agentRequest,
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

const aliceTokenId = '11111111-1111-4111-8111-111111111111';
const bobTokenId = '22222222-2222-4222-8222-222222222222';
const tokenSecret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const feishuUrl =
  'https://open.feishu.cn/open-apis/bot/v2/hook/test-feishu-hook-0001';
const wecomUrl =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-wecom-key-0002';

let database: TestD1Database;
let aliceToken: string;
let bobToken: string;
let fetchMock: ReturnType<typeof vi.fn>;

function seedBob(db: TestD1Database) {
  const now = 1_700_000_000_000;
  db.sqlite
    .prepare(
      'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('user-2', 'bob', 'Bob', null, now, now);
  db.sqlite
    .prepare(
      'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run('project-1', 'user-2', 'member', now);
  const token = `kby_${bobTokenId}_${tokenSecret}`;
  db.sqlite
    .prepare(
      `INSERT INTO agent_tokens
      (id, project_id, user_id, name, token_hash, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at)
     VALUES (?, 'project-1', 'user-2', 'claude', ?, ?, 'task:read,task:write', NULL, NULL, NULL, ?)`,
    )
    .run(
      bobTokenId,
      createHash('sha256').update(token).digest('hex'),
      token.slice(0, 13),
      now,
    );
  return token;
}

function seedChannel(
  db: TestD1Database,
  id: string,
  userId: string | null,
  kind: 'feishu' | 'wecom',
  url: string,
  channelSecret: string | null = null,
) {
  db.sqlite
    .prepare(
      `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
       VALUES (?, 'project-1', ?, ?, ?, ?, 1, 'user-1', 1, 1)`,
    )
    .run(id, userId, kind, url, channelSecret);
}

async function session(user: 'alice' | 'bob') {
  return createSessionToken(
    user === 'alice'
      ? { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null }
      : { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
    sessionSecret,
  );
}

async function webRequest(
  user: 'alice' | 'bob',
  path: string,
  method: string,
  body?: unknown,
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Cookie: `${SESSION_COOKIE}=${await session(user)}`,
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function agentGet(token: string, path: string) {
  return new Request(`${origin}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

let keyCounter = 0;
function patch(token: string, body: Record<string, unknown>) {
  keyCounter += 1;
  return PATCH(agentRequest(token, body, `turn-test-key-${keyCounter}`));
}

function sentBodies() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >,
  }));
}

beforeEach(() => {
  database = createMigratedDatabase();
  configureEnvironment(database);
  seedProject(database);
  aliceToken = seedAgentToken(database, aliceTokenId, tokenSecret, 'codex');
  bobToken = seedBob(database);
  seedTask(database, { id: 'task-00000001', title: 'Ship turns' });
  fetchMock = vi.fn(async () => Response.json({ code: 0, errcode: 0 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  database.close();
});

describe('turn parsing helpers', () => {
  it('parses handoff targets and mentions', () => {
    expect(parseTargetSpec('@alice')).toEqual({ login: 'alice', agent: null });
    expect(parseTargetSpec('bob/agent')).toEqual({
      login: 'bob',
      agent: 'agent',
    });
    expect(parseTargetSpec('@bad login')).toBeNull();
    expect(
      parseMentions(
        '请 @alice 看一下，@bob/claude 复核，邮件 a@b.com 不算，@alice 重复',
      ),
    ).toEqual([
      { login: 'alice', agent: null },
      { login: 'bob', agent: 'claude' },
    ]);
    expect(activityVisibility('comment.created')).toBe('conversation');
    expect(activityVisibility('agent.heartbeat')).toBe('record');
    expect(activityVisibility('github.ci.success')).toBe('record');
  });

  it('accepts only official bot webhooks and never reveals them', () => {
    expect(validateWebhookUrl('feishu', feishuUrl)).toBe(feishuUrl);
    expect(validateWebhookUrl('wecom', wecomUrl)).toBe(wecomUrl);
    expect(
      validateWebhookUrl(
        'feishu',
        'http://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh',
      ),
    ).toBeNull();
    expect(
      validateWebhookUrl(
        'feishu',
        'https://evil.test/open-apis/bot/v2/hook/abcdefgh',
      ),
    ).toBeNull();
    expect(
      validateWebhookUrl(
        'wecom',
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh&x=1',
      ),
    ).toBeNull();
    expect(validateWebhookUrl('wecom', feishuUrl)).toBeNull();
    expect(maskWebhookUrl(feishuUrl)).toBe('open.feishu.cn …0001');
    expect(maskWebhookUrl(wecomUrl)).toBe('qyapi.weixin.qq.com …0002');
  });

  it('signs Feishu payloads when a secret is configured', async () => {
    const payload = await webhookPayload(
      'feishu',
      'hi',
      'sec',
      1_700_000_000_000,
    );
    expect(payload).toMatchObject({
      msg_type: 'text',
      content: { text: 'hi' },
      timestamp: '1700000000',
    });
    expect(typeof (payload as { sign?: unknown }).sign).toBe('string');
    expect(await webhookPayload('wecom', 'hi', null)).toEqual({
      msgtype: 'text',
      text: { content: 'hi' },
    });
  });
});

describe('turn backfill migration', () => {
  it('gives building cards to their first owner and detects pending acceptance', () => {
    const db = new TestD1Database();
    const files = readdirSync('drizzle')
      .filter((file: string) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const turnIndex = files.indexOf('0017_turn_collaboration.sql');
    expect(turnIndex).toBeGreaterThan(0);
    // Apply everything except 0017, seed legacy data, then apply 0017.
    const apply = (file: string) => {
      for (const statement of readFileSync(`drizzle/${file}`, 'utf8')
        .split('--> statement-breakpoint')
        .map((value) => value.trim())
        .filter(Boolean))
        db.exec(statement);
    };
    for (const file of files.slice(0, turnIndex)) apply(file);
    seedProject(db);
    const insert = db.sqlite.prepare(
      `INSERT INTO tasks (id, project_id, title, note, tag, owner_id, owner_login, owner_name, status, position, created_at, updated_at, created_by)
       VALUES (?, 'project-1', ?, '', '产品', 'user-1', 'alice', 'Alice', ?, 0, 1, ?, 'user-1')`,
    );
    insert.run('waiting', 'Waiting', 'building', 10);
    insert.run('active', 'Active', 'building', 20);
    insert.run('idea', 'Idea', 'ideas', 30);
    db.sqlite
      .prepare(
        `INSERT INTO task_events (id, project_id, task_id, source, kind, actor_name, summary, body, created_at)
         VALUES ('e1', 'project-1', 'waiting', 'agent', 'agent.progress', 'codex', 's', '全部通过，待用户验收', 15)`,
      )
      .run();
    apply(files[turnIndex]!);
    const rows = db.sqlite
      .prepare(
        'SELECT id, turn_kind, turn_user_id, turn_reason, turn_since FROM tasks ORDER BY id',
      )
      .all();
    expect(rows).toEqual([
      {
        id: 'active',
        turn_kind: 'member',
        turn_user_id: 'user-1',
        turn_reason: 'developing',
        turn_since: 20,
      },
      {
        id: 'idea',
        turn_kind: null,
        turn_user_id: null,
        turn_reason: null,
        turn_since: null,
      },
      {
        id: 'waiting',
        turn_kind: 'member',
        turn_user_id: 'user-1',
        turn_reason: 'awaiting_acceptance',
        turn_since: 15,
      },
    ]);
    db.close();
  });
});

describe('handoff', () => {
  it('lets an agent hand a card to its owner for acceptance and notifies', async () => {
    seedChannel(
      database,
      'project-bot',
      null,
      'feishu',
      feishuUrl,
      'sign-secret',
    );
    seedChannel(database, 'alice-bot', 'user-1', 'wecom', wecomUrl);
    seedChannel(database, 'bob-bot', 'user-2', 'wecom', wecomUrl);
    expect(
      (await patch(aliceToken, { id: 'KANBY-1', action: 'claim' })).status,
    ).toBe(404);
    expect(
      (await patch(aliceToken, { id: 'task-00000001', action: 'claim' }))
        .status,
    ).toBe(200);

    const response = await patch(aliceToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: 'owner',
      reason: 'awaiting_acceptance',
      note: '看登录和退出两条路径',
    });
    const payload = (await response.json()) as {
      data: {
        turn: { label: string; reason: string; note: string };
        released: boolean;
      };
    };
    expect(response.status).toBe(200);
    expect(payload.data.turn).toMatchObject({
      label: 'Alice',
      reason: 'awaiting_acceptance',
      note: '看登录和退出两条路径',
    });
    expect(payload.data.released).toBe(true);
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS n FROM task_agent_claims')
        .get(),
    ).toEqual({ n: 0 });
    const event = database.sqlite
      .prepare(
        "SELECT summary, body FROM task_events WHERE kind = 'turn.changed'",
      )
      .get() as { summary: string; body: string };
    expect(event.summary).toBe('Alice 的 codex 交给 Alice · 待验收');

    const sent = sentBodies();
    expect(sent.map((item) => item.url).sort()).toEqual(
      [feishuUrl, wecomUrl].sort(),
    );
    const feishu = sent.find((item) => item.url === feishuUrl)!.body;
    expect(feishu.sign).toBeTypeOf('string');
    expect(String((feishu.content as { text: string }).text)).toContain(
      '/project-one/board?task=task-000',
    );
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM notification_deliveries WHERE status = 'sent'",
        )
        .get(),
    ).toEqual({ n: 2 });

    const list = await tasksGET(agentGet(bobToken, '/api/v1/tasks'));
    const tasks = (await list.json()) as {
      data: Array<{ turn: { user: { login: string } } }>;
    };
    expect(tasks.data[0]!.turn.user.login).toBe('alice');
  });

  it('treats a handback from acceptance as a rejection and records failures without blocking', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    seedChannel(database, 'bob-bot', 'user-2', 'wecom', wecomUrl);
    await patch(bobToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: '@alice',
      reason: 'awaiting_acceptance',
    });
    const rejected = await turnPOST(
      await webRequest('alice', '/api/task-turn', 'POST', {
        projectId: 'project-1',
        taskId: 'task-00000001',
        to: { kind: 'agent', userId: 'user-2', tokenId: bobTokenId },
        reason: 'developing',
        note: '退出后仍能看到旧数据',
      }),
    );
    const payload = (await rejected.json()) as {
      rejected: boolean;
      turn: { label: string; kind: string };
    };
    expect(rejected.status).toBe(200);
    expect(payload.rejected).toBe(true);
    expect(payload.turn).toMatchObject({
      kind: 'agent',
      label: 'Bob 的 claude',
    });
    expect(
      database.sqlite
        .prepare("SELECT summary FROM task_events WHERE kind = 'turn.rejected'")
        .get(),
    ).toEqual({ summary: 'Alice 打回了验收，交给 Bob 的 claude' });
    expect(
      database.sqlite
        .prepare('SELECT status, error FROM notification_deliveries')
        .all(),
    ).toEqual([{ status: 'failed', error: 'TypeError' }]);
  });

  it('validates targets and reasons, and can clear a turn', async () => {
    const bad = await patch(aliceToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: '@nobody',
      reason: 'developing',
    });
    expect(bad.status).toBe(400);
    const badReason = await patch(aliceToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: '@bob',
      reason: 'sleeping',
    });
    expect(badReason.status).toBe(400);
    await patch(aliceToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: '@bob/agent',
      reason: 'awaiting_review',
    });
    expect(
      database.sqlite
        .prepare('SELECT turn_kind, turn_user_id, turn_token_id FROM tasks')
        .get(),
    ).toEqual({
      turn_kind: 'agent',
      turn_user_id: 'user-2',
      turn_token_id: null,
    });
    await patch(aliceToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: 'none',
    });
    expect(
      database.sqlite.prepare('SELECT turn_kind, turn_since FROM tasks').get(),
    ).toEqual({ turn_kind: null, turn_since: null });
    const forbidden = await turnPOST(
      new Request(`${origin}/api/task-turn`, {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE}=${await session('alice')}`,
          Origin: 'https://evil.test',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(forbidden.status).toBe(403);
  });
});

describe('comments, mentions and unread content', () => {
  it('lets a non-claiming agent comment and @mention, and queues the mention', async () => {
    seedChannel(database, 'bob-bot', 'user-2', 'feishu', feishuUrl);
    await patch(aliceToken, { id: 'task-00000001', action: 'claim' });
    const comment = await patch(bobToken, {
      id: 'task-00000001',
      action: 'comment',
      body: '@alice 第三步的迁移需要你拍板，@bob 我自己记一下',
    });
    expect(comment.status).toBe(200);
    const mention = database.sqlite
      .prepare(
        'SELECT target_user_id, target_kind, resolved_at FROM task_mentions',
      )
      .all();
    // A member's own agent mentioning that member is still a request to them.
    expect(mention).toEqual([
      { target_user_id: 'user-1', target_kind: 'member', resolved_at: null },
      { target_user_id: 'user-2', target_kind: 'member', resolved_at: null },
    ]);
    const queue = await turnsGET(
      await webRequest('alice', '/api/turns?projectId=project-1', 'GET'),
    );
    const items = (
      (await queue.json()) as {
        items: Array<{ type: string; mention: { by: string } }>;
      }
    ).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'mention',
      mention: { by: 'Bob 的 claude' },
    });

    const reply = await commentPOST(
      await webRequest('alice', '/api/task-events', 'POST', {
        projectId: 'project-1',
        taskId: 'task-00000001',
        body: '用方案 B',
      }),
    );
    expect(reply.status).toBe(201);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM task_mentions WHERE target_user_id = 'user-1' AND resolved_at IS NULL",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('returns comments written since the agent last read the card', async () => {
    await commentPOST(
      await webRequest('alice', '/api/task-events', 'POST', {
        projectId: 'project-1',
        taskId: 'task-00000001',
        body: '先别动 schema',
      }),
    );
    const peek = await tasksGET(
      agentGet(bobToken, '/api/v1/tasks?id=task-00000001&markRead=0'),
    );
    const peeked = (await peek.json()) as {
      data: { unread: Array<{ body: string }> };
    };
    expect(peeked.data.unread.map((event) => event.body)).toEqual([
      '先别动 schema',
    ]);

    const first = await tasksGET(
      agentGet(bobToken, '/api/v1/tasks?id=task-00000001'),
    );
    const firstData = (await first.json()) as {
      data: { unread: unknown[]; thread: Array<{ kind: string }> };
    };
    expect(firstData.data.unread).toHaveLength(1);
    expect(firstData.data.thread.map((event) => event.kind)).toContain(
      'comment.created',
    );

    await patch(bobToken, {
      id: 'task-00000001',
      action: 'progress',
      message: '我的进度',
    });
    const second = await tasksGET(
      agentGet(bobToken, '/api/v1/tasks?id=task-00000001'),
    );
    const secondData = (await second.json()) as {
      data: { unread: unknown[]; lastReadAt: number };
    };
    expect(secondData.data.unread).toEqual([]);
    expect(secondData.data.lastReadAt).toBeTypeOf('number');
  });

  it('kanby next lists the agent and owner turns with unread counts', async () => {
    await patch(aliceToken, {
      id: 'task-00000001',
      action: 'handoff',
      to: '@bob',
      reason: 'awaiting_decision',
    });
    seedTask(database, { id: 'task-00000002', title: 'For another agent' });
    seedTask(database, { id: 'task-00000003', title: 'For bob agents' });
    database.sqlite
      .prepare(
        "UPDATE tasks SET turn_kind = 'agent', turn_user_id = 'user-2', turn_token_id = 'other-token', turn_reason = 'developing', turn_since = 5 WHERE id = 'task-00000002'",
      )
      .run();
    database.sqlite
      .prepare(
        "UPDATE tasks SET turn_kind = 'agent', turn_user_id = 'user-2', turn_token_id = NULL, turn_reason = 'developing', turn_since = 1 WHERE id = 'task-00000003'",
      )
      .run();
    const response = await nextGET(agentGet(bobToken, '/api/v1/next'));
    const data = (
      (await response.json()) as {
        data: {
          agent: { label: string };
          turns: Array<{
            taskId: string;
            unreadCount: number;
            turn: { reasonLabel: string };
          }>;
        };
      }
    ).data;
    expect(data.agent.label).toBe('Bob 的 claude');
    expect(data.turns.map((item) => item.taskId)).toEqual([
      'task-00000003',
      'task-00000001',
    ]);
    expect(data.turns[1]).toMatchObject({
      unreadCount: 1,
      turn: { reasonLabel: '待决策' },
    });
    const unauthorized = await nextGET(new Request(`${origin}/api/v1/next`));
    expect(unauthorized.status).toBe(401);
  });
});

describe('notification channel settings', () => {
  it('stores write-only webhooks with owner-only project scope', async () => {
    const memberProject = await channelsPOST(
      await webRequest('bob', '/api/notification-channels', 'POST', {
        projectId: 'project-1',
        scope: 'project',
        kind: 'feishu',
        webhookUrl: feishuUrl,
      }),
    );
    expect(memberProject.status).toBe(403);
    const invalid = await channelsPOST(
      await webRequest('bob', '/api/notification-channels', 'POST', {
        projectId: 'project-1',
        kind: 'wecom',
        webhookUrl: 'https://example.com/hook',
      }),
    );
    expect(invalid.status).toBe(400);
    const personal = await channelsPOST(
      await webRequest('bob', '/api/notification-channels', 'POST', {
        projectId: 'project-1',
        kind: 'wecom',
        webhookUrl: wecomUrl,
      }),
    );
    const created = (await personal.json()) as {
      channel: { id: string; target: string };
    };
    expect(personal.status).toBe(201);
    expect(JSON.stringify(created)).not.toContain('test-wecom-key');
    const owner = await channelsPOST(
      await webRequest('alice', '/api/notification-channels', 'POST', {
        projectId: 'project-1',
        scope: 'project',
        kind: 'feishu',
        webhookUrl: feishuUrl,
        secret: 'sign-secret',
      }),
    );
    expect(owner.status).toBe(201);

    const listed = await channelsGET(
      await webRequest(
        'alice',
        '/api/notification-channels?projectId=project-1',
        'GET',
      ),
    );
    const listing = (await listed.json()) as {
      channels: Array<{ scope: string; signed: boolean }>;
      canManageProjectChannels: boolean;
    };
    // Alice sees the project bot but not Bob's personal bot.
    expect(listing.channels).toEqual([
      expect.objectContaining({ scope: 'project', signed: true }),
    ]);
    expect(listing.canManageProjectChannels).toBe(true);
    expect(JSON.stringify(listing)).not.toContain('test-feishu-hook');

    const foreignDelete = await channelsDELETE(
      await webRequest(
        'alice',
        `/api/notification-channels?projectId=project-1&id=${created.channel.id}`,
        'DELETE',
      ),
    );
    expect(foreignDelete.status).toBe(404);
    const ownDelete = await channelsDELETE(
      await webRequest(
        'bob',
        `/api/notification-channels?projectId=project-1&id=${created.channel.id}`,
        'DELETE',
      ),
    );
    expect(ownDelete.status).toBe(204);
  });
});

describe('unread paging and D1 parameter limits', () => {
  function seedComments(count: number, start: number) {
    const insert = database.sqlite.prepare(
      `INSERT INTO task_events (id, project_id, task_id, source, kind, actor_id, actor_name, actor_login, summary, body, created_at)
       VALUES (?, 'project-1', 'task-00000001', 'user', 'comment.created', 'user-1', 'Alice', 'alice', 'Alice 发表了评论', ?, ?)`,
    );
    // Pairs share a timestamp so the cursor must order by (created_at, id).
    for (let index = 0; index < count; index += 1)
      insert.run(
        `comment-${String(index).padStart(3, '0')}`,
        `comment ${index}`,
        start + Math.floor(index / 2),
      );
  }

  async function read(query = '') {
    const response = await tasksGET(
      agentGet(bobToken, `/api/v1/tasks?id=task-00000001${query}`),
    );
    expect(response.status).toBe(200);
    return (
      (await response.json()) as {
        data: {
          unread: Array<{ id: string }>;
          unreadHasMore: boolean;
          unreadNextCursor: string | null;
          thread: Array<{ id: string }>;
          threadNextCursor: string | null;
        };
      }
    ).data;
  }

  it('never marks undelivered comments as read', async () => {
    seedComments(35, 1_000);
    const first = await read();
    expect(first.unread).toHaveLength(20);
    expect(first.unreadHasMore).toBe(true);
    const second = await read();
    expect(second.unread).toHaveLength(15);
    expect(second.unreadHasMore).toBe(false);
    expect((await read()).unread).toEqual([]);
    const delivered = [...first.unread, ...second.unread].map(
      (event) => event.id,
    );
    expect(new Set(delivered).size).toBe(35);
    expect(delivered).toEqual(
      Array.from(
        { length: 35 },
        (_, index) => `comment-${String(index).padStart(3, '0')}`,
      ),
    );
  });

  it('pages unread without marking it and pages the thread backwards', async () => {
    seedComments(35, 1_000);
    const peek = await read('&markRead=0&unreadLimit=10');
    expect(peek.unread).toHaveLength(10);
    const next = await read(
      `&markRead=0&unreadLimit=10&after=${encodeURIComponent(peek.unreadNextCursor!)}`,
    );
    expect(next.unread[0]!.id).toBe('comment-010');
    // Peeking did not advance the cursor.
    expect((await read('&markRead=0')).unread[0]!.id).toBe('comment-000');

    const recent = await read('&markRead=0');
    expect(recent.thread).toHaveLength(30);
    expect(recent.thread.at(-1)!.id).toBe('comment-034');
    const older = await read(
      `&markRead=0&threadCursor=${encodeURIComponent(recent.threadNextCursor!)}`,
    );
    expect(older.thread.map((event) => event.id)).toEqual([
      'comment-000',
      'comment-001',
      'comment-002',
      'comment-003',
      'comment-004',
    ]);
    expect(older.threadNextCursor).toBeNull();
    expect(
      (
        await tasksGET(
          agentGet(bobToken, '/api/v1/tasks?id=task-00000001&after=bad'),
        )
      ).status,
    ).toBe(400);
  });

  it("does not let an agent's own comment skip a teammate's earlier one", async () => {
    await read();
    database.sqlite
      .prepare(
        `INSERT INTO task_events (id, project_id, task_id, source, kind, actor_id, actor_name, actor_login, summary, body, created_at)
         VALUES ('human-late', 'project-1', 'task-00000001', 'user', 'comment.created', 'user-1', 'Alice', 'alice', 's', '请先看这个', ?)`,
      )
      .run(Date.now() - 10);
    await patch(bobToken, {
      id: 'task-00000001',
      action: 'comment',
      body: '我先回一句',
    });
    const after = await read();
    expect(after.unread.map((event) => event.id)).toEqual(['human-late']);
  });

  it('keeps kanby next under 100 bound parameters for long queues', async () => {
    const insert = database.sqlite.prepare(
      `INSERT INTO tasks (id, project_id, title, note, tag, owner_id, owner_login, owner_name, status, position, created_at, updated_at, created_by,
         turn_kind, turn_user_id, turn_reason, turn_since)
       VALUES (?, 'project-1', ?, '', '产品', 'user-1', 'alice', 'Alice', 'building', 0, 1, 1, 'user-1', 'member', 'user-2', 'developing', ?)`,
    );
    const mention = database.sqlite.prepare(
      `INSERT INTO task_mentions (id, project_id, task_id, event_id, target_user_id, target_token_id, target_kind, created_by, created_at, resolved_at)
       VALUES (?, 'project-1', ?, 'event', 'user-2', NULL, 'member', 'user-1', ?, NULL)`,
    );
    for (let index = 0; index < 150; index += 1) {
      insert.run(`bulk-${index}`, `Bulk ${index}`, index);
      if (index >= 100) mention.run(`mention-${index}`, `bulk-${index}`, index);
    }
    const response = await nextGET(agentGet(bobToken, '/api/v1/next'));
    expect(response.status).toBe(200);
    const data = (
      (await response.json()) as {
        data: { turns: unknown[]; mentions: unknown[] };
      }
    ).data;
    expect(data.turns).toHaveLength(100);
    expect(data.mentions).toHaveLength(50);
    const { unreadCounts } = await import('@/lib/turns');
    const ids = Array.from({ length: 150 }, (_, index) => `bulk-${index}`);
    await expect(
      unreadCounts('project-1', ids, bobTokenId),
    ).resolves.toBeInstanceOf(Map);
    expect(() =>
      database
        .prepare('SELECT 1')
        .bind(...Array.from({ length: 101 }, () => 1)),
    ).toThrow('at most 100 bound parameters');
  });
});
