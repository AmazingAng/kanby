import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, PATCH, POST } from '@/app/api/v1/tasks/route';
import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  agentRequest,
  configureEnvironment,
  seedAgentToken,
  seedProject,
} from './support/fixtures';

type TaskData = {
  id: string;
  ref: string;
  due?: string;
  note: string;
  status: string;
  acceptanceCriteria: Array<{ id: string; body: string; completed: boolean }>;
};

describe('Agent deadline creation and CLI completion workflow', () => {
  let database: TestD1Database;
  let token: string;
  let server: Server | undefined;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    token = seedAgentToken(
      database,
      '55555555-5555-4555-8555-555555555555',
      'c'.repeat(48),
      'Alice / Codex',
    );
  });
  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    server = undefined;
    database.close();
  });
  function create(body: unknown, key = 'deadline-create-one') {
    const request = agentRequest(token, body, key);
    return POST(new Request(request, { method: 'POST' }));
  }
  function taskCount() {
    return (
      database.sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get() as {
        count: number;
      }
    ).count;
  }
  async function serve() {
    server = createServer(async (request, response) => {
      try {
        let body = '';
        for await (const chunk of request) body += chunk;
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.set(name, value);
        }
        const input = new Request(`https://kanby.test${request.url}`, {
          method: request.method,
          headers,
          ...(body ? { body } : {}),
        });
        const result = await (
          request.method === 'GET'
            ? GET
            : request.method === 'POST'
              ? POST
              : PATCH
        )(input);
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(await result.text());
      } catch {
        response.writeHead(500);
        response.end('Local route handler failed');
      }
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test server address');
    return `http://127.0.0.1:${address.port}`;
  }
  async function cli(url: string, args: string[]) {
    return new Promise<{
      status: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), 'packages/cli/bin/kanby.js'), ...args, '--json'],
        {
          env: { ...process.env, KANBY_TOKEN: token, KANBY_URL: url },
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  }

  it.each(['', 'Release context'])(
    'persists a creation deadline with note %j',
    async (note) => {
      const response = await create({
        title: 'Release',
        due: '2028-02-29',
        note,
      });
      expect(response.status).toBe(201);
      const payload = (await response.json()) as { data: TaskData };
      expect(payload.data.due).toBe('2028-02-29');
      expect(
        database.sqlite
          .prepare('SELECT due FROM tasks WHERE id = ?')
          .get(payload.data.id),
      ).toMatchObject({ due: '2028-02-29' });
      if (note) expect(payload.data.note).toBe(note);
    },
  );

  it.each([
    null,
    true,
    123,
    {},
    'soon',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-09-30T00:00:00Z',
  ])(
    'rejects invalid deadline %j before any card or reservation',
    async (due) => {
      const response = await create({ title: 'Invalid deadline', due });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_due' },
      });
      expect(taskCount()).toBe(0);
      const corrected = await create({
        title: 'Valid deadline',
        due: '2026-09-30',
      });
      expect(corrected.status).toBe(201);
    },
  );

  it.each([{}, { due: '' }])(
    'preserves no-deadline creation for %j',
    async (fields) => {
      const response = await create({ title: 'No deadline', ...fields });
      expect(response.status).toBe(201);
      expect(
        ((await response.json()) as { data: TaskData }).data.due,
      ).toBeUndefined();
      expect(
        database.sqlite.prepare('SELECT due FROM tasks').get(),
      ).toMatchObject({ due: null });
    },
  );

  it('replays the same creation and rejects a different deadline under the same key', async () => {
    const body = { title: 'Release', due: '2026-09-30' };
    const first = await create(body);
    const payload = (await first.json()) as { data: TaskData };
    const replay = await create(body);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(payload);
    const changed = await create({ ...body, due: '2026-10-01' });
    expect(changed.status).toBe(409);
    expect(taskCount()).toBe(1);
    expect(
      database.sqlite.prepare('SELECT due FROM tasks').get(),
    ).toMatchObject({ due: body.due });
  });

  it('round-trips generated date-only deadlines without a timezone conversion', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 73000 }), async (day) => {
        const due = new Date(Date.UTC(1900, 0, 1) + day * 86400000)
          .toISOString()
          .slice(0, 10);
        const response = await create(
          { title: 'Generated deadline', due },
          `generated-${day}`,
        );
        expect(response.status).toBe(201);
        expect(((await response.json()) as { data: TaskData }).data.due).toBe(
          due,
        );
      }),
      { numRuns: 30 },
    );
  });

  it('runs create with deadline, claim, checklist checks and complete through the actual CLI and API', async () => {
    const url = await serve();
    const created = await cli(url, [
      'task',
      'create',
      'Release',
      '--due',
      '2026-09-30',
      '--note',
      'Release context',
    ]);
    expect(created.status).toBe(0);
    const task = JSON.parse(created.stdout) as TaskData;
    expect(task.due).toBe('2026-09-30');
    expect(
      database.sqlite.prepare('SELECT due FROM tasks').get(),
    ).toMatchObject({ due: '2026-09-30' });
    expect((await cli(url, ['task', 'claim', task.ref])).status).toBe(0);
    expect(
      (await cli(url, ['task', 'checklist', 'add', task.ref, 'Tests pass']))
        .status,
    ).toBe(0);
    expect(
      (await cli(url, ['task', 'checklist', 'add', task.ref, 'Docs updated']))
        .status,
    ).toBe(0);
    const listed = JSON.parse(
      (await cli(url, ['task', 'checklist', task.ref])).stdout,
    ) as TaskData['acceptanceCriteria'];
    expect(listed.map((item) => item.completed)).toEqual([false, false]);
    expect(
      (await cli(url, ['task', 'checklist', 'check', task.ref, '1'])).status,
    ).toBe(0);
    expect(
      (await cli(url, ['task', 'checklist', 'check', task.ref, listed[1]!.id]))
        .status,
    ).toBe(0);
    const checked = JSON.parse(
      (await cli(url, ['task', 'checklist', task.ref])).stdout,
    ) as TaskData['acceptanceCriteria'];
    expect(checked.map((item) => item.completed)).toEqual([true, true]);
    const complete = await cli(url, [
      'task',
      'complete',
      task.ref,
      '--message',
      'Tests pass; docs verified',
    ]);
    expect(complete.status).toBe(0);
    expect(JSON.parse(complete.stdout)).toMatchObject({
      status: 'shipped',
      due: '2026-09-30',
      acceptanceCriteria: [{ completed: true }, { completed: true }],
    });
    expect(
      database.sqlite.prepare('SELECT status, due FROM tasks').get(),
    ).toMatchObject({ status: 'shipped', due: '2026-09-30' });
  });

  it('consumes an empty deadline option placed before the creation title', async () => {
    const result = await cli(await serve(), [
      'task',
      'create',
      '--due',
      '',
      'Release',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ title: 'Release' });
    expect(JSON.parse(result.stdout).due).toBeUndefined();
  });

  it('clears a deadline using an explicit empty CLI value', async () => {
    const response = await create({ title: 'Clear deadline' });
    const { data: task } = (await response.json()) as { data: TaskData };
    database.sqlite
      .prepare('UPDATE tasks SET due = ? WHERE id = ?')
      .run('2026-09-30', task.id);
    const result = await cli(await serve(), [
      'task',
      'update',
      task.ref,
      '--due',
      '',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).due).toBeUndefined();
    expect(
      database.sqlite.prepare('SELECT due FROM tasks').get(),
    ).toMatchObject({ due: null });
  });

  it.each(['create', 'update'])(
    'rejects a missing --due value in CLI %s',
    async (command) => {
      const result = await cli('http://127.0.0.1:1', [
        'task',
        command,
        'Release',
        '--due',
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--due requires a date');
      expect(result.stderr).not.toContain(token);
    },
  );
});
