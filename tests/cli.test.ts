import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

const cli = join(process.cwd(), 'packages/cli/bin/kanby.js');
const cliPackage = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/cli/package.json'), 'utf8'),
) as { version: string };
const temporaryDirectories: string[] = [];

function runCli(arguments_: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...arguments_], {
        env: environment,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    },
  );
}

function temporaryConfigRoot() {
  const path = mkdtempSync(join(tmpdir(), 'kanby-cli-test-'));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('Kanby CLI credential contract', () => {
  it('prints the release version', () => {
    const result = spawnSync(process.execPath, [cli, '--version'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(cliPackage.version);
  });

  it('documents the accepted task tags', () => {
    const result = spawnSync(process.execPath, [cli, '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--tag 产品|设计|代码|增长');
  });

  it('uses exit code 2 when no credential is configured', () => {
    const result = spawnSync(
      process.execPath,
      [cli, 'task', 'list', '--json'],
      {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: temporaryConfigRoot(),
          KANBY_TOKEN: '',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
  });

  it('does not replace a working credential when login validation fails', async () => {
    const configRoot = temporaryConfigRoot();
    const configDirectory = join(configRoot, 'kanby');
    const configPath = join(configDirectory, 'config.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(configDirectory, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        token: 'kby_working_token',
        url: 'https://existing.test',
      }),
      { mode: 0o600 },
    );

    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((_request, response) => {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ ok: false, error: { message: 'Rejected' } }),
        );
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(
      [
        'auth',
        'login',
        '--token',
        `kby_${'x'.repeat(48)}`,
        '--url',
        `http://127.0.0.1:${port}`,
      ],
      { ...process.env, XDG_CONFIG_HOME: configRoot },
    );
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      token: 'kby_working_token',
      url: 'https://existing.test',
    });
  });

  it('does not send an Agent Token to an insecure non-loopback origin', () => {
    const token = `kby_${'s'.repeat(48)}`;
    const result = spawnSync(
      process.execPath,
      [cli, 'task', 'list', '--json'],
      {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: temporaryConfigRoot(),
          KANBY_TOKEN: token,
          KANBY_URL: 'http://kanby.example',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HTTPS origin');
    expect(result.stderr).not.toContain(token);
  });

  it('does not follow an authenticated API redirect', async () => {
    let requests = 0;
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((_request, response) => {
        requests += 1;
        response.writeHead(302, { Location: '/redirected' });
        response.end();
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const token = `kby_${'s'.repeat(48)}`;
    const result = await runCli(['task', 'list'], {
      ...process.env,
      XDG_CONFIG_HOME: temporaryConfigRoot(),
      KANBY_TOKEN: token,
      KANBY_URL: `http://127.0.0.1:${port}`,
    });
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(1);
    expect(requests).toBe(1);
    expect(result.stderr).not.toContain(token);
  });

  it('rejects an invalid task tag before sending the Agent Token', async () => {
    let requests = 0;
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((_request, response) => {
        requests += 1;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, data: {} }));
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const token = `kby_${'s'.repeat(48)}`;

    const result = await runCli(
      ['task', 'update', 'task-ref', '--tag', 'cli-smoke'],
      {
        ...process.env,
        XDG_CONFIG_HOME: temporaryConfigRoot(),
        KANBY_TOKEN: token,
        KANBY_URL: `http://127.0.0.1:${port}`,
      },
    );
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Tag must be one of: 产品, 设计, 代码, 增长',
    );
    expect(result.stderr).not.toContain(token);
    expect(requests).toBe(0);
  });

  it('rejects arbitrary non-enum task tags locally', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 24 })
          .filter((tag) => !['产品', '设计', '代码', '增长'].includes(tag)),
        async (tag) => {
          const token = `kby_${'s'.repeat(48)}`;
          const result = await runCli(
            ['task', 'update', 'task-ref', '--tag', tag],
            {
              ...process.env,
              XDG_CONFIG_HOME: temporaryConfigRoot(),
              KANBY_TOKEN: token,
              KANBY_URL: 'http://127.0.0.1:9',
            },
          );
          expect(result.status).toBe(1);
          expect(result.stderr).toContain(
            'Tag must be one of: 产品, 设计, 代码, 增长',
          );
          expect(result.stderr).not.toContain(token);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('sends a valid task tag in an update', async () => {
    let receivedBody: unknown;
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          receivedBody = JSON.parse(body);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                ref: 'KANBY-1',
                status: 'ideas',
                owner: { login: 'alice' },
                title: 'Tagged task',
                tag: '代码',
              },
            }),
          );
        });
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(
      ['task', 'update', 'KANBY-1', '--tag', '代码'],
      {
        ...process.env,
        XDG_CONFIG_HOME: temporaryConfigRoot(),
        KANBY_TOKEN: `kby_${'s'.repeat(48)}`,
        KANBY_URL: `http://127.0.0.1:${port}`,
      },
    );
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(0);
    expect(receivedBody).toEqual({
      id: 'KANBY-1',
      action: 'update',
      tag: '代码',
    });
  });

  it('archives a task through the Agent API', async () => {
    let receivedBody: unknown;
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          receivedBody = JSON.parse(body);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                ref: 'KANBY-1',
                status: 'shipped',
                owner: { login: 'alice' },
                title: 'Archived task',
                archivedAt: 1_700_000_000_001,
              },
            }),
          );
        });
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(['task', 'archive', 'KANBY-1'], {
      ...process.env,
      XDG_CONFIG_HOME: temporaryConfigRoot(),
      KANBY_TOKEN: `kby_${'s'.repeat(48)}`,
      KANBY_URL: `http://127.0.0.1:${port}`,
    });
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(0);
    expect(receivedBody).toEqual({ id: 'KANBY-1', action: 'archive' });
    expect(result.stdout).toContain('Archived KANBY-1');
  });

  it('sends one quoted positional argument per child for task split', async () => {
    let receivedBody: unknown;
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          receivedBody = JSON.parse(body);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                parentUpdatedAt: 2,
                tasks: [
                  {
                    ref: 'child-1',
                    status: 'ideas',
                    owner: { login: 'alice' },
                    title: 'Write tests',
                  },
                  {
                    ref: 'child-2',
                    status: 'ideas',
                    owner: { login: 'alice' },
                    title: 'Ship code',
                  },
                ],
              },
            }),
          );
        });
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(
      ['task', 'split', 'parent-ref', 'Write tests', 'Ship code'],
      {
        ...process.env,
        XDG_CONFIG_HOME: temporaryConfigRoot(),
        KANBY_TOKEN: `kby_${'s'.repeat(48)}`,
        KANBY_URL: `http://127.0.0.1:${port}`,
      },
    );
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Created 2 subtasks');
    expect(receivedBody).toEqual({
      id: 'parent-ref',
      action: 'split',
      titles: ['Write tests', 'Ship code'],
    });
  });

  it('renders acceptance criteria in human-readable task detail', async () => {
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              ref: 'task-123',
              status: 'building',
              owner: { login: 'alice' },
              owners: [{ login: 'alice' }, { login: 'bob' }],
              title: 'Ship checklist',
              note: 'Ready for review',
              acceptanceCriteria: [
                { body: 'Tests pass', completed: true },
                { body: 'Docs updated', completed: false },
              ],
            },
          }),
        );
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(['task', 'get', 'task-123'], {
      ...process.env,
      XDG_CONFIG_HOME: temporaryConfigRoot(),
      KANBY_TOKEN: `kby_${'s'.repeat(48)}`,
      KANBY_URL: `http://127.0.0.1:${port}`,
    });
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Acceptance criteria:');
    expect(result.stdout).toContain('@alice, @bob');
    expect(result.stdout).toContain('- [x] Tests pass');
    expect(result.stdout).toContain('- [ ] Docs updated');
  });

  it('adds a structured acceptance criterion', async () => {
    let receivedBody: unknown;
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          receivedBody = JSON.parse(body);
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ok: true,
              data: {
                acceptanceCriteria: [
                  { id: 'criterion-abc', body: 'Tests pass', completed: false },
                ],
              },
            }),
          );
        });
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(
      ['task', 'checklist', 'add', 'task-ref', 'Tests pass'],
      {
        ...process.env,
        XDG_CONFIG_HOME: temporaryConfigRoot(),
        KANBY_TOKEN: `kby_${'s'.repeat(48)}`,
        KANBY_URL: `http://127.0.0.1:${port}`,
      },
    );
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(0);
    expect(receivedBody).toEqual({
      id: 'task-ref',
      action: 'checklist.add',
      body: 'Tests pass',
    });
    expect(result.stdout).toContain('1. [ ] Tests pass');
  });

  it('resolves a one-based checklist number before checking it', async () => {
    const received: Array<{ method?: string; body?: unknown }> = [];
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          received.push({
            method: request.method,
            body: body ? JSON.parse(body) : undefined,
          });
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              ok: true,
              data:
                request.method === 'GET'
                  ? {
                      acceptanceCriteria: [
                        {
                          id: 'criterion-first',
                          body: 'First',
                          completed: false,
                        },
                        {
                          id: 'criterion-second',
                          body: 'Second',
                          completed: false,
                        },
                      ],
                    }
                  : {
                      acceptanceCriteria: [
                        {
                          id: 'criterion-second',
                          body: 'Second',
                          completed: true,
                        },
                      ],
                    },
            }),
          );
        });
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runCli(
      ['task', 'checklist', 'check', 'task-ref', '2'],
      {
        ...process.env,
        XDG_CONFIG_HOME: temporaryConfigRoot(),
        KANBY_TOKEN: `kby_${'s'.repeat(48)}`,
        KANBY_URL: `http://127.0.0.1:${port}`,
      },
    );
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.status).toBe(0);
    expect(received).toEqual([
      { method: 'GET', body: undefined },
      {
        method: 'PATCH',
        body: {
          id: 'task-ref',
          action: 'checklist.check',
          criterionId: 'criterion-second',
        },
      },
    ]);
  });
});
