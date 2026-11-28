import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import * as auth from '@/app/api/mini/auth/route';
import * as account from '@/app/api/mini/account/route';
import * as tasks from '@/app/api/mini/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

type MiniResult = {
  pairingCode: string;
  token: string;
  taskUpdatedAt: number;
  activity: { items: Array<{ body: string }> };
};
async function payload(response: Response): Promise<MiniResult> {
  return (await response.json()) as MiniResult;
}
let db: TestD1Database;
let cookie: string;
let provider: ReturnType<typeof vi.fn>;
const runtime = env as unknown as Record<string, unknown>;
function request(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
  browser = false,
) {
  return new Request(`${origin}/api/mini/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(browser
        ? { Cookie: `${SESSION_COOKIE}=${cookie}`, Origin: origin }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function login() {
  return auth.POST(
    request('auth', 'POST', { action: 'login', code: 'wx-code' }),
  );
}
async function paired() {
  const pending = (await payload(await login())) as { pairingCode: string };
  expect(
    (
      await account.POST(
        request(
          'account',
          'POST',
          { pairingCode: pending.pairingCode },
          undefined,
          true,
        ),
      )
    ).status,
  ).toBe(200);
  const session = (await payload(await login())) as { token: string };
  expect(session.token).toMatch(/^km_[A-Za-z0-9_-]{43}$/);
  return session.token;
}
beforeEach(async () => {
  db = createMigratedDatabase();
  configureEnvironment(db);
  seedProject(db);
  seedTask(db);
  runtime.WEIXIN_MINI_APP_ID = 'wx0123456789abcdef';
  runtime.WEIXIN_MINI_APP_SECRET = 'mini-secret';
  cookie = await createSessionToken(
    { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
    sessionSecret,
  );
  provider = vi.fn(async () =>
    Response.json({ openid: 'wx-user-1', session_key: 'must-never-return' }),
  );
  vi.stubGlobal('fetch', provider);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  db.close();
});

describe('mini identity and member API', () => {
  it('fails closed without configuration and rejects invalid JSON before provider exchange', async () => {
    delete runtime.WEIXIN_MINI_APP_SECRET;
    expect((await login()).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    runtime.WEIXIN_MINI_APP_SECRET = 'mini-secret';
    expect(
      (await auth.POST(request('auth', 'POST', { action: 'login', code: '' })))
        .status,
    ).toBe(400);
    expect(
      (await auth.POST(request('auth', 'POST', { action: 'other' }))).status,
    ).toBe(400);
    expect(
      (
        await auth.POST(
          new Request(`${origin}/api/mini/auth`, { method: 'POST', body: 'x' }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await auth.POST(
          new Request(`${origin}/api/mini/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await auth.POST(
          request('auth', 'POST', { action: 'login', code: 'x'.repeat(20000) }),
        )
      ).status,
    ).toBe(413);
  });
  it('binds once, never discloses identity secrets, and isolates mini tokens from cookies', async () => {
    const pending = await payload(await login());
    expect(pending).toMatchObject({ status: 'unlinked' });
    expect(JSON.stringify(pending)).not.toMatch(
      /wx-user-1|must-never-return|mini-secret/,
    );
    expect(
      (
        await account.POST(
          request('account', 'POST', { pairingCode: pending.pairingCode }),
        )
      ).status,
    ).toBe(403);
    const cross = request(
      'account',
      'POST',
      { pairingCode: pending.pairingCode },
      undefined,
      true,
    );
    cross.headers.set('Origin', 'https://evil.test');
    expect((await account.POST(cross)).status).toBe(403);
    expect(
      (
        await account.POST(
          request(
            'account',
            'POST',
            { pairingCode: pending.pairingCode },
            undefined,
            true,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await account.POST(
          request(
            'account',
            'POST',
            { pairingCode: pending.pairingCode },
            undefined,
            true,
          ),
        )
      ).status,
    ).toBe(409);
    const session = await payload(await login());
    expect(JSON.stringify(session)).not.toMatch(
      /wx-user-1|must-never-return|mini-secret|githubAdminAccountIds/,
    );
    expect(
      await (
        await tasks.GET(request('tasks', 'GET', undefined, session.token))
      ).json(),
    ).toMatchObject({ projects: [{ id: 'project-1' }] });
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, undefined, true)))
        .status,
    ).toBe(401);
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, cookie))).status,
    ).toBe(401);
    const { getSessionUser } = await import('@/lib/auth');
    expect(
      await getSessionUser(
        new Request(origin, {
          headers: { Cookie: `${SESSION_COOKIE}=${session.token}` },
        }),
      ),
    ).toBeNull();
    const stored = JSON.stringify(
      db.sqlite.prepare('SELECT * FROM mini_sessions').all(),
    );
    expect(stored).not.toContain(session.token);
    expect(provider.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });
  it('rejects expired pair codes and stale browser authorization', async () => {
    const pending = await payload(await login());
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    expect(
      (
        await account.POST(
          request(
            'account',
            'POST',
            { pairingCode: pending.pairingCode },
            undefined,
            true,
          ),
        )
      ).status,
    ).toBe(403);
    cookie = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    expect(
      (
        await account.POST(
          request(
            'account',
            'POST',
            { pairingCode: pending.pairingCode },
            undefined,
            true,
          ),
        )
      ).status,
    ).toBe(409);
    vi.restoreAllMocks();
  });
  it('revokes on logout, unlink, expiry and application change', async () => {
    let token = await paired();
    expect(
      (await auth.POST(request('auth', 'POST', { action: 'logout' }, token)))
        .status,
    ).toBe(200);
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, token))).status,
    ).toBe(401);
    token = (await payload(await login())).token;
    expect(
      await (
        await account.GET(request('account', 'GET', undefined, undefined, true))
      ).json(),
    ).toMatchObject({ linked: true });
    expect(
      (
        await account.DELETE(
          request('account', 'DELETE', undefined, undefined, true),
        )
      ).status,
    ).toBe(200);
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, token))).status,
    ).toBe(401);
    token = await paired();
    runtime.WEIXIN_MINI_APP_ID = 'wx1111111111111111';
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, token))).status,
    ).toBe(401);
    runtime.WEIXIN_MINI_APP_ID = 'wx0123456789abcdef';
    db.sqlite.exec('UPDATE mini_sessions SET expires_at=1');
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, token))).status,
    ).toBe(401);
  });
  it('rejects provider redirects, errors and malformed identity without leaking details', async () => {
    for (const response of [
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.test' },
      }),
      Response.json({ errcode: 40029, errmsg: 'secret' }),
      Response.json({}),
      Response.json({ openid: 42 }),
      new Response('oops'),
    ]) {
      provider.mockResolvedValueOnce(response);
      const result = await login();
      expect(result.status).toBe(502);
      expect(await result.text()).not.toContain('secret');
    }
    provider.mockRejectedValueOnce(new Error('secret'));
    expect((await login()).status).toBe(502);
  });
  it('limits unauthenticated exchanges before calling WeChat', async () => {
    for (let i = 0; i < 10; i++) expect((await login()).status).toBe(200);
    expect((await login()).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(10);
  });
  it('enforces membership on queue, detail, comments and checklist writes', async () => {
    const token = await paired();
    expect(
      (
        await tasks.GET(
          request('tasks?projectId=foreign', 'GET', undefined, token),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await tasks.GET(
          request(
            'tasks?projectId=project-1&taskId=missing',
            'GET',
            undefined,
            token,
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      await payload(
        await tasks.GET(
          request(
            'tasks?projectId=project-1&taskId=task-00000001',
            'GET',
            undefined,
            token,
          ),
        ),
      ),
    ).toMatchObject({ task: { title: 'Original' }, activity: { items: [] } });
    expect(
      (
        await tasks.POST(
          request(
            'tasks',
            'POST',
            {
              action: 'comment',
              projectId: 'project-1',
              taskId: 'task-00000001',
              body: '请验收',
            },
            token,
          ),
        )
      ).status,
    ).toBe(201);
    const detail = await payload(
      await tasks.GET(
        request(
          'tasks?projectId=project-1&taskId=task-00000001',
          'GET',
          undefined,
          token,
        ),
      ),
    );
    expect(
      detail.activity.items.some((e: { body: string }) => e.body === '请验收'),
    ).toBe(true);
    db.sqlite.exec("DELETE FROM project_members WHERE user_id='user-1'");
    expect(
      (
        await tasks.GET(
          request('tasks?projectId=project-1', 'GET', undefined, token),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await tasks.POST(
          request(
            'tasks',
            'POST',
            {
              action: 'comment',
              projectId: 'project-1',
              taskId: 'task-00000001',
              body: 'denied',
            },
            token,
          ),
        )
      ).status,
    ).toBe(403);
  });
  it('requires completed criteria and current revision to accept without overwriting content', async () => {
    const token = await paired();
    db.sqlite.exec("UPDATE tasks SET status='building'");
    const { createAcceptanceCriterion } = await import('@/lib/db');
    const created = await createAcceptanceCriterion(
      'project-1',
      'task-00000001',
      '验收登录',
      1700000000000,
      {
        actorId: 'user-1',
        actorName: 'Alice',
        actorLogin: 'alice',
        actorAvatarUrl: null,
      },
    );
    const body = {
      action: 'accept',
      projectId: 'project-1',
      taskId: 'task-00000001',
      updatedAt: created!.taskUpdatedAt,
    };
    expect(
      (await tasks.POST(request('tasks', 'POST', body, token))).status,
    ).toBe(409);
    const item = created!.acceptanceCriteria[0]!;
    const checked = await tasks.POST(
      request(
        'tasks',
        'POST',
        {
          ...body,
          action: 'check',
          id: item.id,
          completed: true,
          itemUpdatedAt: item.updatedAt,
        },
        token,
      ),
    );
    expect(checked.status).toBe(200);
    expect(
      (await tasks.POST(request('tasks', 'POST', body, token))).status,
    ).toBe(409);
    const revision = (await payload(checked)).taskUpdatedAt;
    const accepted = await tasks.POST(
      request('tasks', 'POST', { ...body, updatedAt: revision }, token),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      task: { status: 'shipped', title: 'Original', owner: { id: 'user-1' } },
    });
    expect(
      (
        await tasks.POST(
          request('tasks', 'POST', { ...body, updatedAt: revision }, token),
        )
      ).status,
    ).toBe(409);
  });
});

describe('mini adversarial and concurrency checks', () => {
  it('allows only one binding winner, rejects reassignment, and never creates users', async () => {
    const pending = await payload(await login());
    db.sqlite
      .prepare('INSERT INTO users VALUES (?,?,?,?,?,?)')
      .run('user-2', 'bob', 'Bob', null, 1, 1);
    const alice = request(
      'account',
      'POST',
      { pairingCode: pending.pairingCode },
      undefined,
      true,
    );
    cookie = await createSessionToken(
      { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
      sessionSecret,
    );
    const bob = request(
      'account',
      'POST',
      { pairingCode: pending.pairingCode },
      undefined,
      true,
    );
    const outcomes = await Promise.all([
      account.POST(alice),
      account.POST(bob),
    ]);
    expect(outcomes.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_identities').get(),
    ).toEqual({ n: 1 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({
      n: 2,
    });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM project_members').get(),
    ).toEqual({ n: 1 });
    expect(
      JSON.stringify(db.sqlite.prepare('SELECT * FROM mini_pairs').all()),
    ).not.toContain(pending.pairingCode);
  });
  it('allows at most one identity per account and never resurrects old sessions after relinking', async () => {
    const old = await paired();
    provider.mockResolvedValueOnce(Response.json({ openid: 'second-wechat' }));
    const pending = await payload(await login());
    expect(
      (
        await account.POST(
          request(
            'account',
            'POST',
            { pairingCode: pending.pairingCode },
            undefined,
            true,
          ),
        )
      ).status,
    ).toBe(409);
    await account.DELETE(
      request('account', 'DELETE', undefined, undefined, true),
    );
    await paired();
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, old))).status,
    ).toBe(401);
  });
  it('uses short lived pairing and bounded session retention and clears expired rows', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const pending = await payload(await login());
    expect(
      JSON.stringify(db.sqlite.prepare('SELECT * FROM mini_pairs').all()),
    ).not.toContain(pending.pairingCode);
    db.sqlite.exec('UPDATE mini_pairs SET expires_at=1');
    expect(
      (
        await account.POST(
          request(
            'account',
            'POST',
            { pairingCode: pending.pairingCode },
            undefined,
            true,
          ),
        )
      ).status,
    ).toBe(409);
    const first = await paired();
    for (let i = 0; i < 6; i++) expect((await login()).status).toBe(200);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_sessions').get(),
    ).toEqual({ n: 5 });
    expect(
      (await tasks.GET(request('tasks', 'GET', undefined, first))).status,
    ).toBe(401);
    db.sqlite.exec(
      'UPDATE mini_sessions SET expires_at=1; UPDATE mini_pairs SET expires_at=1; UPDATE mini_limits SET expires_at=1',
    );
    expect((await login()).status).toBe(200);
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_sessions').get(),
    ).toEqual({ n: 1 });
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_pairs').get(),
    ).toEqual({ n: 0 });
  });
  it('lists the real queue, resolves task refs, pages comments and rejects hostile input', async () => {
    const token = await paired();
    db.sqlite.exec(
      "UPDATE tasks SET turn_kind='member',turn_user_id='user-1',turn_reason='awaiting_acceptance',turn_since=1,status='building',task_number=99",
    );
    const queue = await tasks.GET(
      request('tasks?projectId=project-1', 'GET', undefined, token),
    );
    expect(await queue.json()).toMatchObject({
      items: [{ taskId: 'task-00000001', ref: 'KANBY-99' }],
    });
    const ref = await tasks.GET(
      request(
        'tasks?projectId=project-1&taskId=KANBY-99',
        'GET',
        undefined,
        token,
      ),
    );
    expect(ref.status).toBe(200);
    expect(
      (
        await tasks.GET(
          request(
            'tasks?projectId=project-1&taskId=KANBY-99&cursor=evil',
            'GET',
            undefined,
            token,
          ),
        )
      ).status,
    ).toBe(400);
    const ids = {
      projectId: 'project-1',
      taskId: 'task-00000001',
      updatedAt: 1700000000000,
    };
    for (const body of [
      { ...ids, action: 'unknown' },
      { ...ids, action: 'comment', body: '' },
      { ...ids, action: 'comment', body: 123 },
      { ...ids, action: 'comment', body: 'x'.repeat(2001) },
      { ...ids, action: 'accept', updatedAt: '1700000000000' },
      { ...ids, action: 'check', completed: 'true' },
    ]) {
      expect(
        (await tasks.POST(request('tasks', 'POST', body, token))).status,
      ).toBe(400);
    }
    expect(
      (
        await tasks.POST(
          request(
            'tasks',
            'POST',
            {
              ...ids,
              action: 'check',
              id: 'absent',
              completed: true,
              itemUpdatedAt: 1,
            },
            token,
          ),
        )
      ).status,
    ).toBe(404);
    for (let i = 0; i < 22; i++)
      expect(
        (
          await tasks.POST(
            request(
              'tasks',
              'POST',
              { ...ids, action: 'comment', body: `message ${i}` },
              token,
            ),
          )
        ).status,
      ).toBe(201);
    const response = await tasks.GET(
      request(
        'tasks?projectId=project-1&taskId=KANBY-99',
        'GET',
        undefined,
        token,
      ),
    );
    const detail = (await response.json()) as {
      activity: { items: unknown[]; nextCursor: string };
    };
    expect(detail.activity.items).toHaveLength(20);
    expect(detail.activity.nextCursor).toBeTruthy();
    const next = await tasks.GET(
      request(
        `tasks?projectId=project-1&taskId=KANBY-99&cursor=${encodeURIComponent(detail.activity.nextCursor)}`,
        'GET',
        undefined,
        token,
      ),
    );
    expect((await payload(next)).activity.items).toHaveLength(2);
    db.sqlite.exec('UPDATE tasks SET archived_at=1');
    expect((await refAgain()).status).toBe(404);
    function refAgain() {
      return tasks.GET(
        request(
          'tasks?projectId=project-1&taskId=KANBY-99',
          'GET',
          undefined,
          token,
        ),
      );
    }
  });
  it('returns conflicts for concurrent acceptance and stale checklist item revisions', async () => {
    const token = await paired();
    db.sqlite.exec("UPDATE tasks SET status='building'");
    // D1 serializes batches. Model that transaction boundary in the in-memory adapter.
    const batch = db.batch.bind(db);
    let chain = Promise.resolve();
    db.batch = (statements) => {
      const next = chain.then(() => batch(statements));
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };
    const input = {
      action: 'accept',
      projectId: 'project-1',
      taskId: 'task-00000001',
      updatedAt: 1700000000000,
    };
    const results = await Promise.all([
      tasks.POST(request('tasks', 'POST', input, token)),
      tasks.POST(request('tasks', 'POST', input, token)),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM task_events WHERE kind='task.updated'",
        )
        .get(),
    ).toEqual({ n: 1 });
    const { createAcceptanceCriterion, listTasks } = await import('@/lib/db');
    const current = (await listTasks('project-1'))[0]!;
    const result = await createAcceptanceCriterion(
      'project-1',
      current.id,
      'new criterion',
      current.updatedAt,
      {
        actorId: 'user-1',
        actorName: 'Alice',
        actorLogin: 'alice',
        actorAvatarUrl: null,
      },
    );
    expect(
      (
        await tasks.POST(
          request(
            'tasks',
            'POST',
            {
              ...input,
              action: 'check',
              updatedAt: result!.taskUpdatedAt,
              id: result!.acceptanceCriteria[0]!.id,
              completed: true,
              itemUpdatedAt: 1,
            },
            token,
          ),
        )
      ).status,
    ).toBe(409);
  });
  it('returns a safe error on storage outage and migration rollback preserves existing tasks', async () => {
    const token = await paired();
    db.sqlite.exec('DROP TABLE task_events');
    const response = await tasks.GET(
      request(
        'tasks?projectId=project-1&taskId=task-00000001',
        'GET',
        undefined,
        token,
      ),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/SQL|table|token|secret/);
    for (const table of [
      'mini_sessions',
      'mini_pairs',
      'mini_identities',
      'mini_limits',
    ])
      db.sqlite.exec(`DROP TABLE ${table}`);
    expect(db.sqlite.prepare('SELECT title FROM tasks').get()).toEqual({
      title: 'Original',
    });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({
      n: 1,
    });
  });
  it('rejects arbitrary bearer strings and body types without granting access', async () => {
    const fc = await import('fast-check');
    const token = await paired();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 120 }), async (value) => {
        if (value === token) return;
        const safe = value.replace(/[^\x20-\x7e]/g, '');
        expect(
          (await tasks.GET(request('tasks', 'GET', undefined, safe))).status,
        ).toBe(401);
      }),
      { numRuns: 50, seed: 20261128 },
    );
    for (const code of [null, 123, {}, [], true, 'short'])
      expect(
        (
          await account.POST(
            request('account', 'POST', { pairingCode: code }, undefined, true),
          )
        ).status,
      ).toBe(400);
    runtime.WEIXIN_MINI_APP_ID = 'bad';
    expect((await login()).status).toBe(503);
  });
});

it('reports unlinked status and handles unavailable activity storage without exposing internals', async () => {
  expect(
    await (
      await account.GET(request('account', 'GET', undefined, undefined, true))
    ).json(),
  ).toMatchObject({ linked: false, linkedAt: null });
  const token = await paired();
  const prepare = db.prepare.bind(db);
  db.prepare = (query: string) => {
    if (query.includes('ORDER BY created_at DESC, id DESC LIMIT ?'))
      throw new Error('SQL storage unavailable with secret details');
    return prepare(query);
  };
  const response = await tasks.GET(
    request(
      'tasks?projectId=project-1&taskId=task-00000001',
      'GET',
      undefined,
      token,
    ),
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toMatch(/SQL|storage|secret/);
});
it('refuses acceptance when a task owner is no longer a project member', async () => {
  const token = await paired();
  db.sqlite.exec("UPDATE tasks SET owner_id='former-member',status='building'");
  expect(
    (
      await tasks.POST(
        request(
          'tasks',
          'POST',
          {
            action: 'accept',
            projectId: 'project-1',
            taskId: 'task-00000001',
            updatedAt: 1700000000000,
          },
          token,
        ),
      )
    ).status,
  ).toBe(409);
  expect(db.sqlite.prepare('SELECT status FROM tasks').get()).toEqual({
    status: 'building',
  });
});

it('rejects well-formed forged mini tokens with an active identity present', async () => {
  const token = await paired();
  const fc = await import('fast-check');
  await fc.assert(
    fc.asyncProperty(
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      async (bytes) => {
        const forged = `km_${Buffer.from(bytes).toString('base64url')}`;
        if (forged === token) return;
        expect(
          (await tasks.GET(request('tasks', 'GET', undefined, forged))).status,
        ).toBe(401);
      },
    ),
    { seed: 145, numRuns: 50 },
  );
});

it('does not report successful login when the binding is removed before session insertion', async () => {
  await paired();
  const batch = db.batch.bind(db);
  db.batch = async (statements) => {
    if (
      statements.some((statement) =>
        statement.query.includes('INSERT INTO mini_sessions'),
      )
    ) {
      db.sqlite.exec('DELETE FROM mini_sessions; DELETE FROM mini_identities');
    }
    return batch(statements);
  };
  const response = await login();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('token');
  expect(
    db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_sessions').get(),
  ).toEqual({ n: 0 });
});
