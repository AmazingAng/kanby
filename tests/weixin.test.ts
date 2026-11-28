import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, GET, POST } from '@/app/api/weixin/route';
import { PATCH } from '@/app/api/v1/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { openCredential, sealCredential } from '@/lib/weixin-crypto';
import { safeILinkBaseUrl } from '@/lib/weixin-ilink';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  agentRequest,
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

const tokenId = '44444444-4444-4444-8444-444444444444';
const tokenSecret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const botCredential = 'bot-credential-value';
const wecomUrl =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-wecom-key-0003';

let database: TestD1Database;
let agentToken: string;
let calls: Array<{
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}>;
let sendResult: Record<string, unknown>;
let statusGate: Promise<void> | null;

function iLinkResponder(url: string, init?: RequestInit) {
  // Cloudflare Workers rejects this mode before making any network request.
  if (init?.redirect === 'error')
    throw new TypeError('Invalid redirect value: error');
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\//, '');
  const body =
    typeof init?.body === 'string'
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : null;
  const auth = new Headers(init?.headers).get('authorization');
  calls.push({ path, body, auth });
  if (path === 'ilink/bot/get_bot_qrcode')
    return Response.json({
      qrcode: 'qr-handle',
      qrcode_img_content: 'https://liteapp.weixin.qq.com/q/test',
    });
  if (path === 'ilink/bot/get_qrcode_status' && statusGate)
    return statusGate.then(() =>
      Response.json({
        status: 'confirmed',
        bot_token: botCredential,
        ilink_bot_id: 'bot-1@im.bot',
        ilink_user_id: 'owner@im.wechat',
      }),
    );
  if (path === 'ilink/bot/get_qrcode_status')
    return Response.json({
      status: 'confirmed',
      bot_token: botCredential,
      ilink_bot_id: 'bot-1@im.bot',
      ilink_user_id: 'owner@im.wechat',
      baseurl: 'https://ilinkai.weixin.qq.com',
    });
  if (path === 'ilink/bot/getupdates')
    return Response.json({
      ret: 0,
      get_updates_buf: 'cursor-2',
      msgs: [
        {
          from_user_id: 'stranger@im.wechat',
          context_token: 'ctx-stranger',
          message_type: 1,
        },
        {
          from_user_id: 'owner@im.wechat',
          context_token: 'ctx-owner',
          message_type: 1,
          item_list: [{ type: 1, text_item: { text: 'hi' } }],
        },
      ],
    });
  if (path === 'ilink/bot/sendmessage') return Response.json(sendResult);
  // Feishu/WeCom bots.
  return Response.json({ errcode: 0 });
}

async function web(method: string, body?: unknown) {
  const session = await createSessionToken(
    { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
    sessionSecret,
  );
  return new Request(`${origin}/api/weixin`, {
    method,
    headers: {
      Cookie: `${SESSION_COOKIE}=${session}`,
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function bindAndActivate() {
  const started = await POST(await web('POST', { action: 'start' }));
  const { loginId, qrcodeSvg } = (await started.json()) as {
    loginId: string;
    qrcodeSvg: string;
  };
  expect(qrcodeSvg).toContain('<svg');
  const checked = await POST(await web('POST', { action: 'check', loginId }));
  expect(await checked.json()).toMatchObject({
    progress: 'confirmed',
    account: { status: 'pending' },
  });
  const synced = await POST(await web('POST', { action: 'sync' }));
  expect(await synced.json()).toMatchObject({ account: { status: 'active' } });
}

beforeEach(() => {
  database = createMigratedDatabase();
  configureEnvironment(database);
  Object.assign(env, {
    WEIXIN_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  seedProject(database);
  agentToken = seedAgentToken(database, tokenId, tokenSecret, 'codex');
  seedTask(database, { id: 'task-00000001', title: 'WeChat turn' });
  calls = [];
  sendResult = { ret: 0 };
  statusGate = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => iLinkResponder(url, init)),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (env as Record<string, unknown>).WEIXIN_CREDENTIAL_KEY;
  database.close();
});

describe('hosted WeChat credentials', () => {
  it('seals credentials per member and field', async () => {
    const sealed = await sealCredential('user-1', 'bot_token', 'secret-value');
    expect(sealed).not.toContain('secret-value');
    expect(await openCredential('user-1', 'bot_token', sealed)).toBe(
      'secret-value',
    );
    await expect(
      openCredential('user-2', 'bot_token', sealed),
    ).rejects.toThrow();
    await expect(
      openCredential('user-1', 'context_token', sealed),
    ).rejects.toThrow();
  });

  it('only talks to weixin.qq.com hosts', () => {
    expect(safeILinkBaseUrl('https://ilinkai.weixin.qq.com/x')).toBe(
      'https://ilinkai.weixin.qq.com',
    );
    expect(safeILinkBaseUrl('sh.ilinkai.weixin.qq.com')).toBe(
      'https://sh.ilinkai.weixin.qq.com',
    );
    expect(safeILinkBaseUrl('https://weixin.qq.com.evil.test')).toBeNull();
    expect(safeILinkBaseUrl('http://ilinkai.weixin.qq.com')).toBeNull();
    expect(safeILinkBaseUrl('https://ilinkai.weixin.qq.com:8443')).toBeNull();
  });

  it('is unavailable without the Worker secret', async () => {
    delete (env as Record<string, unknown>).WEIXIN_CREDENTIAL_KEY;
    const status = await GET(await web('GET'));
    expect(await status.json()).toEqual({ enabled: false, account: null });
    const started = await POST(await web('POST', { action: 'start' }));
    expect(started.status).toBe(503);
  });
});

describe('WeChat binding flow', () => {
  it('binds by QR, activates from the owner message and sends', async () => {
    await bindAndActivate();
    const stored = database.sqlite
      .prepare('SELECT * FROM weixin_accounts')
      .get() as Record<string, string>;
    // Nothing sensitive is stored in plaintext.
    expect(JSON.stringify(stored)).not.toContain(botCredential);
    expect(JSON.stringify(stored)).not.toContain('owner@im.wechat');
    expect(JSON.stringify(stored)).not.toContain('ctx-owner');
    expect(stored.updates_buf).toBe('cursor-2');

    const status = await GET(await web('GET'));
    const statusText = await status.text();
    expect(statusText).not.toContain(botCredential);
    expect(JSON.parse(statusText)).toMatchObject({
      enabled: true,
      account: { status: 'active' },
    });

    const test = await POST(await web('POST', { action: 'test' }));
    expect(test.status).toBe(200);
    const send = calls.find((call) => call.path === 'ilink/bot/sendmessage')!;
    expect(send.auth).toBe(`Bearer ${botCredential}`);
    expect(send.body).toMatchObject({
      msg: {
        to_user_id: 'owner@im.wechat',
        context_token: 'ctx-owner',
        message_type: 2,
      },
    });

    expect((await DELETE(await web('DELETE'))).status).toBe(204);
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS n FROM weixin_accounts')
        .get(),
    ).toEqual({ n: 0 });
  });

  it('prefers WeChat for notifications and falls back to personal bots', async () => {
    await bindAndActivate();
    database.sqlite
      .prepare(
        `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
         VALUES ('alice-bot', 'project-1', 'user-1', 'wecom', ?, NULL, 1, 'user-1', 1, 1)`,
      )
      .run(wecomUrl);
    calls = [];
    await PATCH(
      agentRequest(
        agentToken,
        {
          id: 'task-00000001',
          action: 'handoff',
          to: 'owner',
          reason: 'awaiting_acceptance',
        },
        'weixin-handoff-0001',
      ),
    );
    expect(calls.map((call) => call.path)).toEqual(['ilink/bot/sendmessage']);
    const text = (
      calls[0]!.body!.msg as {
        item_list: Array<{ text_item: { text: string } }>;
      }
    ).item_list[0]!.text_item.text;
    expect(text).toContain('轮到 Alice（待验收）');

    // Move the first delivery out of the coalescing window.
    database.sqlite.exec(
      'UPDATE notification_deliveries SET created_at = created_at - 600000',
    );
    // An expired bot token falls back to the personal WeCom bot.
    sendResult = { ret: -14, errmsg: 'session timeout' };
    calls = [];
    await PATCH(
      agentRequest(
        agentToken,
        {
          id: 'task-00000001',
          action: 'handoff',
          to: 'owner',
          reason: 'awaiting_decision',
        },
        'weixin-handoff-0002',
      ),
    );
    expect(calls.map((call) => call.path)).toEqual([
      'ilink/bot/sendmessage',
      'cgi-bin/webhook/send',
    ]);
    expect(
      database.sqlite.prepare('SELECT status FROM weixin_accounts').get(),
    ).toEqual({ status: 'expired' });
  });

  it.each([301, 302, 303, 307, 308])(
    'rejects fallback webhook redirect %i',
    async (status) => {
      database.sqlite
        .prepare(
          `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
       VALUES ('redirect-bot', 'project-1', 'user-1', 'wecom', ?, NULL, 1, 'user-1', 1, 1)`,
        )
        .run(wecomUrl);
      let forwarded = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.redirect === 'error')
            throw new TypeError('Invalid redirect value: error');
          if (init?.redirect !== 'manual') {
            forwarded = true;
            return Response.json({ errcode: 0 });
          }
          return new Response('{"errcode":0}', {
            status,
            headers: { Location: 'https://untrusted.example/collect' },
          });
        }),
      );
      await PATCH(
        agentRequest(
          agentToken,
          {
            id: 'task-00000001',
            action: 'handoff',
            to: 'owner',
            reason: 'awaiting_acceptance',
          },
          'webhook-redirect-0001',
        ),
      );
      expect(forwarded).toBe(false);
      expect(
        database.sqlite
          .prepare(
            "SELECT status, error FROM notification_deliveries WHERE channel_id = 'redirect-bot'",
          )
          .get(),
      ).toEqual({ status: 'failed', error: `HTTP ${status}` });
    },
  );

  it('ignores a QR confirmation that lands after the member unbound', async () => {
    let release!: () => void;
    statusGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = await POST(await web('POST', { action: 'start' }));
    const { loginId } = (await started.json()) as { loginId: string };
    const pending = POST(await web('POST', { action: 'check', loginId }));
    // Let the check reach iLink, then unbind while it is waiting.
    await vi.waitFor(() =>
      expect(
        calls.some((call) => call.path === 'ilink/bot/get_qrcode_status'),
      ).toBe(true),
    );
    expect((await DELETE(await web('DELETE'))).status).toBe(204);
    release();
    const late = (await (await pending).json()) as {
      progress: string;
      account: unknown;
    };
    expect(late).toEqual({ progress: 'expired', account: null });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS n FROM weixin_accounts')
        .get(),
    ).toEqual({ n: 0 });
  });

  it('ignores a confirmation for a superseded login session', async () => {
    const first = (await (
      await POST(await web('POST', { action: 'start' }))
    ).json()) as {
      loginId: string;
    };
    await POST(await web('POST', { action: 'start' }));
    const stale = (await (
      await POST(await web('POST', { action: 'check', loginId: first.loginId }))
    ).json()) as { progress: string };
    expect(stale.progress).toBe('expired');
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS n FROM weixin_accounts')
        .get(),
    ).toEqual({ n: 0 });
  });
});
