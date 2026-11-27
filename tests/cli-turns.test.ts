import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as nextGET } from '@/app/api/v1/next/route';
import { GET as tasksGET, PATCH as tasksPATCH } from '@/app/api/v1/tasks/route';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  seedAgentToken,
  seedProject,
} from './support/fixtures';

const cli = join(process.cwd(), 'packages/cli/bin/kanby.js');
const tokenId = '33333333-3333-4333-8333-333333333333';
const tokenSecret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';

let database: TestD1Database;
let server: Server;
let baseUrl: string;
let token: string;
let configRoot: string;

function runCli(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configRoot,
          KANBY_TOKEN: token,
          KANBY_URL: baseUrl,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    },
  );
}

beforeEach(async () => {
  database = createMigratedDatabase();
  configureEnvironment(database);
  seedProject(database);
  token = seedAgentToken(database, tokenId, tokenSecret, 'codex');
  database.sqlite
    .prepare(
      `INSERT INTO tasks (id, project_id, task_number, title, note, tag, owner_id, owner_login, owner_name, status, position, created_at, updated_at, created_by)
       VALUES ('task-cli-0001', 'project-1', 7, 'CLI turn', '', '产品', 'user-1', 'alice', 'Alice', 'building', 0, 1, 1, 'user-1')`,
    )
    .run();
  configRoot = mkdtempSync(join(tmpdir(), 'kanby-cli-turns-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Bridge the CLI's HTTP calls to the real route handlers.
  server = createServer((incoming, outgoing) => {
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk) => (body += chunk));
    incoming.on('end', () => {
      void (async () => {
        const url = new URL(incoming.url ?? '/', baseUrl);
        const request = new Request(url, {
          method: incoming.method,
          headers: incoming.headers as Record<string, string>,
          body: ['GET', 'HEAD'].includes(incoming.method ?? 'GET')
            ? undefined
            : body,
        });
        const handler =
          url.pathname === '/api/v1/next'
            ? nextGET
            : incoming.method === 'PATCH'
              ? tasksPATCH
              : tasksGET;
        const response = await handler(request);
        outgoing.writeHead(response.status, {
          'Content-Type': 'application/json',
        });
        outgoing.end(await response.text());
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(configRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  database.close();
});

describe('turn-based CLI commands', () => {
  it('hands off, comments with mentions, and shows the queue with new content', async () => {
    const handoff = await runCli([
      'task',
      'handoff',
      'KANBY-7',
      '--to',
      'owner',
      '--reason',
      'awaiting_acceptance',
      '--note',
      '看登录流程',
    ]);
    expect(handoff.stderr).toBe('');
    expect(handoff.stdout).toContain('Handed KANBY-7 to Alice · 待验收');

    const badReason = await runCli([
      'task',
      'handoff',
      'KANBY-7',
      '--to',
      'owner',
      '--reason',
      'later',
    ]);
    expect(badReason.status).toBe(1);

    const mention = await runCli([
      'task',
      'mention',
      'KANBY-7',
      '@alice',
      '请确认文案',
    ]);
    expect(mention.status).toBe(0);
    expect(mention.stdout).toContain('notified @alice');
    expect(
      database.sqlite
        .prepare("SELECT body FROM task_events WHERE kind = 'comment.created'")
        .get(),
    ).toEqual({ body: '@alice 请确认文案' });

    database.sqlite
      .prepare(
        `INSERT INTO task_events (id, project_id, task_id, source, kind, actor_id, actor_name, actor_login, summary, body, created_at)
         VALUES ('human-1', 'project-1', 'task-cli-0001', 'user', 'comment.created', 'user-1', 'Alice', 'alice', 'Alice 发表了评论', '第二步不对', ?)`,
      )
      .run(Date.now() + 1000);

    const next = await runCli(['next']);
    expect(next.status).toBe(0);
    expect(next.stdout).toContain('Alice 的 codex');
    expect(next.stdout).toMatch(/KANBY-7\t待验收\tAlice\twaiting \d+m\t1 new/);
    expect(next.stdout).toContain('Mentions:');

    const peek = await runCli(['task', 'get', 'KANBY-7', '--no-mark-read']);
    expect(peek.stdout).toContain('Turn: Alice · 待验收 (awaiting_acceptance)');
    expect(peek.stdout).toContain('第二步不对');
    const json = await runCli(['task', 'get', 'KANBY-7', '--json']);
    expect(
      (JSON.parse(json.stdout) as { unread: Array<{ body: string }> }).unread,
    ).toEqual([expect.objectContaining({ body: '第二步不对' })]);
  });
});
