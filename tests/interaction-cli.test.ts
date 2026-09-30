import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v1/sessions/route';
import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  seedAgentToken,
  seedProject,
  seedTask,
} from './support/fixtures';
let db: TestD1Database, url: string, token: string, configDir: string;
const server = createServer(async (req, res) => {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = new Request(`${url}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body ? { body } : {}),
    });
    const response = await (req.method === 'POST' ? POST : GET)(request);
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(await response.text());
  } catch {
    res.writeHead(500);
    res.end('{}');
  }
});
beforeAll(async () => {
  db = createMigratedDatabase();
  configureEnvironment(db);
  seedProject(db);
  seedTask(db);
  token = seedAgentToken(
    db,
    randomUUID(),
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN',
    'CLI test',
  );
  configDir = await mkdtemp(join(tmpdir(), 'kanby-session-cli-'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
  await rm(configDir, { recursive: true, force: true });
});
function cli(args: string[]) {
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['packages/cli/bin/kanby.js', 'session', ...args],
        {
          env: {
            ...process.env,
            KANBY_URL: url,
            KANBY_TOKEN: token,
            XDG_CONFIG_HOME: configDir,
          },
        },
      );
      let out = '',
        err = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      child.on('error', reject);
      child.on('exit', (code) => resolve({ code, out, err }));
    },
  );
}
it('runs a real CLI project session and records correlated per-turn interactions', async () => {
  const id = randomUUID();
  let r = await cli(['start', '--id', id, '--client', 'codex', '--json']);
  expect(r.code).toBe(0);
  let s = JSON.parse(r.out);
  expect(s.taskId).toBe(null);
  r = await cli(['prompt', id, '--event-id', randomUUID(), '--json']);
  expect(r.code).toBe(0);
  r = await cli(['wait', id, '--reason', 'review', '--json']);
  expect(r.code).toBe(0);
  s = JSON.parse(r.out);
  r = await cli([
    'reply',
    id,
    '--request',
    s.wait.id,
    '--decision',
    'changes',
    '--json',
  ]);
  expect(r.code).toBe(0);
  r = await cli(['end', id, '--outcome', 'handed-off', '--json']);
  expect(r.code).toBe(0);
  r = await cli(['events', id, '--json']);
  expect(JSON.parse(r.out).events.map((e: { kind: string }) => e.kind)).toEqual(
    ['start', 'prompt', 'wait', 'reply', 'end'],
  );
  r = await cli([
    'report',
    '--from',
    '2026-01-01',
    '--to',
    '2026-12-31',
    '--json',
  ]);
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out).coverage.complete).toBe(false);
  r = await cli(['list', '--json']);
  expect(
    JSON.parse(r.out).sessions.some((s: { id: string }) => s.id === id),
  ).toBe(true);
});
it('validates arguments and reports retry identifiers without credentials', async () => {
  expect((await cli(['wait', randomUUID(), '--reason'])).code).toBe(1);
  expect(
    (await cli(['start', '--client', 'codex', '--user', 'someone'])).code,
  ).toBe(1);
  const id = randomUUID();
  const r = await cli([
    'start',
    '--id',
    id,
    '--client',
    'codex',
    '--task',
    'missing',
    '--json',
  ]);
  expect(r.code).toBe(1);
  expect(r.out + r.err).toContain(id);
  expect(r.out + r.err).not.toContain(token);
});
it('wraps a process without collecting its output and leaves successful work awaiting acceptance', async () => {
  const id = randomUUID();
  let r = await cli([
    'run',
    '--id',
    id,
    '--client',
    'test',
    '--',
    process.execPath,
    '-e',
    'process.stdout.write("private-output")',
  ]);
  expect(r.code).toBe(0);
  expect(r.out).toContain('private-output');
  r = await cli(['get', id, '--json']);
  expect(JSON.parse(r.out)).toMatchObject({
    status: 'waiting',
    wait: { reason: 'acceptance' },
  });
  r = await cli(['events', id, '--json']);
  expect(r.out).not.toContain('private-output');
  const failed = randomUUID();
  r = await cli([
    'run',
    '--id',
    failed,
    '--client',
    'test',
    '--',
    process.execPath,
    '-e',
    'process.exit(7)',
  ]);
  expect(r.code).toBe(7);
  r = await cli(['get', failed, '--json']);
  expect(JSON.parse(r.out)).toMatchObject({
    status: 'ended',
    outcome: 'failed',
  });
});

it('passes child flags through and preserves handoffs already recorded by the child', async () => {
  const id = randomUUID();
  const version = await cli([
    'run',
    '--id',
    id,
    '--client',
    'test',
    '--',
    process.execPath,
    '--version',
  ]);
  expect(version.code).toBe(0);
  expect(version.out.trim()).toBe(process.version);
  const handed = randomUUID();
  const script =
    "const {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath,['packages/cli/bin/kanby.js','session','wait','--reason','review'],{stdio:'ignore',env:process.env});process.exit(r.status);";
  const result = await cli([
    'run',
    '--id',
    handed,
    '--client',
    'test',
    '--',
    process.execPath,
    '-e',
    script,
  ]);
  expect(result.code).toBe(0);
  const r = await cli(['get', handed, '--json']);
  expect(JSON.parse(r.out)).toMatchObject({
    status: 'waiting',
    wait: { reason: 'review' },
  });
});

it('never launches a child again for an already existing session ID', async () => {
  const id = randomUUID();
  expect(
    (await cli(['start', '--id', id, '--client', 'test', '--json'])).code,
  ).toBe(0);
  const r = await cli([
    'run',
    '--id',
    id,
    '--client',
    'test',
    '--',
    process.execPath,
    '-e',
    'process.stdout.write("must-not-run")',
  ]);
  expect(r.code).toBe(1);
  expect(r.out).not.toContain('must-not-run');
});
