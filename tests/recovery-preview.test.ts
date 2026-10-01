import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { env } from 'cloudflare:workers';
import { authenticateAgent } from '@/lib/agent';
import { recoverySnapshot } from '@/lib/recovery';
import { GET as callback } from '@/app/api/auth/github/callback/route';
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from '@/lib/auth';
import { recoveryPreviewResponse } from '../tools/recovery-preview.mjs';
import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
} from './support/fixtures';

let db: TestD1Database;
beforeEach(() => {
  db = createMigratedDatabase();
  configureEnvironment(db);
  seedProject(db);
  vi.stubEnv('KANBY_RECOVERY_SNAPSHOT', '2026-10-01 backup');
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('requires an explicit snapshot label to enable recovery', () => {
  expect(recoverySnapshot()).toBe('2026-10-01 backup');
  vi.stubEnv('KANBY_RECOVERY_SNAPSHOT', ' ');
  expect(recoverySnapshot()).toBeNull();
  vi.stubEnv('KANBY_RECOVERY_SNAPSHOT', undefined);
  expect(recoverySnapshot()).toBeNull();
});
it('rejects arbitrary mutating requests including webhooks before dispatch', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
      fc.constantFrom(
        '/api/tasks',
        '/api/v1/sessions',
        '/api/github/webhook',
        '/app',
        '/__kanby_recovery',
      ),
      (method, path) => {
        const r = recoveryPreviewResponse(
          new Request(origin + path, { method }),
          'backup',
        );
        expect(r?.status).toBe(403);
        expect(r?.headers.get('cache-control')).toBe('no-store');
      },
    ),
  );
});
it('allows reads and cookie-only logout, blocks side-effectful and unknown APIs', async () => {
  for (const path of [
    '/',
    '/demo',
    '/app',
    '/api/tasks',
    '/api/v1/sessions',
    '/api/auth/github/callback',
  ]) {
    for (const method of ['GET', 'HEAD'])
      expect(
        recoveryPreviewResponse(
          new Request(origin + path, { method }),
          'backup',
        ),
      ).toBeNull();
  }
  expect(
    recoveryPreviewResponse(
      new Request(origin + '/api/auth/logout', { method: 'POST' }),
      'backup',
    ),
  ).toBeNull();
  for (const path of [
    '/api/github/setup',
    '/api/github/connect',
    '/api/new-write-endpoint',
    '/api/github/setup/',
    '/api/%67ithub/setup',
  ]) {
    expect(
      recoveryPreviewResponse(new Request(origin + path), 'backup')?.status,
    ).toBe(403);
  }
  const rejected = recoveryPreviewResponse(
    new Request(origin + '/api/tasks', { method: 'POST' }),
    'backup',
  )!;
  const body = (await rejected.json()) as { error: { code: string } };
  expect(body.error.code).toBe('RECOVERY_READ_ONLY');
  expect(
    recoveryPreviewResponse(
      new Request(origin + '/api/tasks', { method: 'POST' }),
      '',
    ),
  ).toBeNull();
});
it('authenticates Agent reads without changing token timestamps', async () => {
  const token = seedAgentToken(
    db,
    randomUUID(),
    randomUUID().replaceAll('-', '') + randomUUID(),
    'test',
  );
  const request = new Request(origin + '/api/v1/tasks', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await authenticateAgent(request, 'task:read')).not.toBeNull();
  expect(
    db.sqlite.prepare('SELECT last_used_at FROM agent_tokens').get(),
  ).toMatchObject({ last_used_at: null });
  vi.stubEnv('KANBY_RECOVERY_SNAPSHOT', '');
  expect(await authenticateAgent(request, 'task:read')).not.toBeNull();
  expect(
    db.sqlite.prepare('SELECT last_used_at FROM agent_tokens').get(),
  ).not.toMatchObject({ last_used_at: null });
});
it.each([true, false])(
  'OAuth allows only existing members without changing the snapshot (member=%s)',
  async (member) => {
    Object.assign(env, {
      ALLOWED_GITHUB_LOGINS: '',
      ALLOWED_GITHUB_ORGS: '',
      ALLOWED_GITHUB_TEAMS: '',
    });
    if (member) {
      db.sqlite.exec(
        "INSERT INTO users(id,login,name,created_at,updated_at) VALUES ('42','snapshot-member','Snapshot Name',1,1); INSERT INTO project_members(project_id,user_id,role,created_at) VALUES ('project-1','42','member',1)",
      );
    }
    const before = db.sqlite.prepare('SELECT * FROM users ORDER BY id').all();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/login/oauth/access_token'))
          return Response.json({ access_token: randomUUID() });
        if (url === 'https://api.github.com/user')
          return Response.json({
            id: 42,
            login: 'new-login',
            name: 'New Name',
          });
        return Response.json([]);
      }),
    );
    const response = await callback(
      new Request(origin + '/api/auth/github/callback?code=test&state=state', {
        headers: {
          cookie: `${OAUTH_STATE_COOKIE}=state; ${OAUTH_VERIFIER_COOKIE}=verifier`,
        },
      }),
    );
    expect(response.status).toBe(member ? 302 : 403);
    expect(db.sqlite.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(
      before,
    );
  },
);

it.each(['', '2026-10-01 backup'])(
  'generated Worker enforces the recovery boundary and cron policy (%s)',
  (snapshot) => {
    const dir = mkdtempSync(join(tmpdir(), 'kanby-recovery-'));
    try {
      mkdirSync(join(dir, 'dist/server'), { recursive: true });
      mkdirSync(join(dir, 'tools'));
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      writeFileSync(
        join(dir, 'dist/server/index.js'),
        'export default { fetch() { return new Response("application"); } };',
      );
      writeFileSync(join(dir, 'dist/server/wrangler.json'), '{}');
      copyFileSync(
        'tools/recovery-preview.mjs',
        join(dir, 'tools/recovery-preview.mjs'),
      );
      execFileSync(
        process.execPath,
        [resolve('tools/add-worker-schedule.mjs')],
        {
          cwd: dir,
          env: {
            ...process.env,
            KANBY_XAPI: '',
            KANBY_RECOVERY_SNAPSHOT: snapshot,
          },
        },
      );
      const config = JSON.parse(
        readFileSync(join(dir, 'dist/server/wrangler.json'), 'utf8'),
      );
      expect(config.triggers.crons).toEqual(snapshot ? [] : ['*/10 * * * *']);
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
      import app from './dist/server/index.js';
      const waits = [];
      const response = await app.fetch(new Request('https://test/api/tasks', {method:'POST'}), {}, {});
      app.scheduled(null, {GITHUB_WEBHOOK_SECRET:crypto.randomUUID()}, {waitUntil:p=>waits.push(p)});
      await Promise.all(waits);
      console.log(JSON.stringify({status:response.status,jobs:waits.length}));
    `,
          ],
          { cwd: dir, encoding: 'utf8' },
        ),
      );
      expect(result).toEqual({
        status: snapshot ? 403 : 200,
        jobs: snapshot ? 0 : 1,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
