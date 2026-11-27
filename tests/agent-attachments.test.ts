import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST as webPOST } from '@/app/api/attachments/route';
import { GET, POST } from '@/app/api/v1/attachments/route';
import { PATCH } from '@/app/api/v1/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { createTaskAttachment } from '@/lib/db';

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

const tokenOneId = '11111111-1111-4111-8111-111111111111';
const tokenTwoId = '22222222-2222-4222-8222-222222222222';
const tokenSecret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const taskId = 'task-00000001';

class MemoryBucket {
  objects = new Map<
    string,
    { bytes: ArrayBuffer; options?: R2PutOptions | undefined }
  >();

  async put(key: string, value: ReadableStream, options?: R2PutOptions) {
    const bytes = await new Response(value).arrayBuffer();
    this.objects.set(key, { bytes, options });
    return { key, size: bytes.byteLength };
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(object.bytes).body,
      size: object.bytes.byteLength,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

async function multipart(
  token: string | null,
  fields: Record<string, string | File>,
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const encoded = new Request(`${origin}/api/v1/attachments`, {
    method: 'POST',
    body: form,
  });
  const body = await encoded.arrayBuffer();
  return new Request(`${origin}/api/v1/attachments`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': encoded.headers.get('content-type') ?? '',
      'Content-Length': String(body.byteLength),
      ...headers,
    },
    body,
  });
}

function textFile(contents: string, name = 'notes.txt', type = 'text/plain') {
  return new File([contents], name, { type });
}

function getRequest(token: string, query: string) {
  return new Request(`${origin}/api/v1/attachments?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Agent attachment API', () => {
  let database: TestD1Database;
  let bucket: MemoryBucket;
  let tokenOne: string;
  let tokenTwo: string;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    bucket = new MemoryBucket();
    Object.assign(env, { ATTACHMENTS: bucket });
    seedProject(database);
    seedTask(database, { id: taskId });
    tokenOne = seedAgentToken(database, tokenOneId, tokenSecret, 'agent-one');
    tokenTwo = seedAgentToken(database, tokenTwoId, tokenSecret, 'agent-two');
  });

  afterEach(() => {
    database.close();
    delete (env as Record<string, unknown>).ATTACHMENTS;
  });

  it('uploads, lists, downloads, and records the upload in task activity', async () => {
    const response = await POST(
      await multipart(tokenOne, {
        task: taskId,
        file: textFile('hello agent', '日志.txt', 'TEXT/Plain'),
      }),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      data: {
        id: string;
        name: string;
        size: number;
        contentType: string;
        url: string;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      name: '日志.txt',
      size: 11,
      contentType: 'text/plain',
      url: `/api/v1/attachments?id=${payload.data.id}`,
    });
    expect(bucket.objects.size).toBe(1);
    const [stored] = [...bucket.objects.values()];
    expect(stored.options?.customMetadata).toMatchObject({
      taskId,
      uploadedBy: 'user-1',
      agentTokenId: tokenOneId,
    });

    const update = database.sqlite
      .prepare(
        'SELECT kind, message FROM task_agent_updates WHERE task_id = ? AND token_id = ?',
      )
      .get(taskId, tokenOneId) as { kind: string; message: string };
    expect(update).toEqual({ kind: 'attached', message: '上传附件 日志.txt' });
    const event = database.sqlite
      .prepare('SELECT kind, summary FROM task_events WHERE task_id = ?')
      .get(taskId) as { kind: string; summary: string };
    expect(event).toEqual({
      kind: 'agent.attached',
      summary: 'Alice 的 agent-one 上传了附件',
    });

    const list = await GET(getRequest(tokenTwo, `task=${taskId}`));
    const listed = (await list.json()) as { data: Array<{ id: string }> };
    expect(list.status).toBe(200);
    expect(listed.data.map((item) => item.id)).toEqual([payload.data.id]);

    const download = await GET(getRequest(tokenTwo, `id=${payload.data.id}`));
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('text/plain');
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(await download.text()).toBe('hello agent');
  });

  it('replays an idempotent retry without storing a duplicate', async () => {
    const send = async () =>
      POST(
        await multipart(
          tokenOne,
          { task: taskId, file: textFile('same bytes') },
          { 'Idempotency-Key': 'attach-retry-1' },
        ),
      );
    const first = (await (await send()).json()) as { data: { id: string } };
    const second = await send();
    const replayed = (await second.json()) as { data: { id: string } };

    expect(second.status).toBe(201);
    expect(replayed.data.id).toBe(first.data.id);
    expect(bucket.objects.size).toBe(1);

    const conflict = await POST(
      await multipart(
        tokenOne,
        { task: taskId, file: textFile('different bytes') },
        { 'Idempotency-Key': 'attach-retry-1' },
      ),
    );
    expect(conflict.status).toBe(409);
  });

  it('rejects missing tokens and tokens without the required scope', async () => {
    const anonymous = await POST(
      await multipart(null, { task: taskId, file: textFile('x') }),
    );
    expect(anonymous.status).toBe(401);

    database.sqlite
      .prepare("UPDATE agent_tokens SET scopes = 'task:read' WHERE id = ?")
      .run(tokenOneId);
    const readOnly = await POST(
      await multipart(tokenOne, { task: taskId, file: textFile('x') }),
    );
    expect(readOnly.status).toBe(401);
    expect(bucket.objects.size).toBe(0);

    database.sqlite
      .prepare("UPDATE agent_tokens SET scopes = 'task:write' WHERE id = ?")
      .run(tokenOneId);
    const writeOnlyList = await GET(getRequest(tokenOne, `task=${taskId}`));
    expect(writeOnlyList.status).toBe(401);
  });

  it('rejects files larger than 10 MB', async () => {
    const response = await POST(
      await multipart(tokenOne, {
        task: taskId,
        file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.bin'),
      }),
    );
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe('file_too_large');
    expect(bucket.objects.size).toBe(0);
  });

  it('rejects uploads beyond ten attachments per task', async () => {
    for (let index = 0; index < 10; index += 1)
      await createTaskAttachment({
        projectId: 'project-1',
        taskId,
        objectKey: `existing-${index}`,
        fileName: `existing-${index}.txt`,
        contentType: 'text/plain',
        size: 1,
        createdBy: 'user-1',
      });
    const response = await POST(
      await multipart(tokenOne, { task: taskId, file: textFile('x') }),
    );
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('attachment_limit');
    expect(bucket.objects.size).toBe(0);
  });

  it('accepts review evidence while another Agent Token holds the claim', async () => {
    const claim = await PATCH(
      agentRequest(
        tokenTwo,
        { id: taskId, action: 'claim', leaseMinutes: 15 },
        'claim-key-0001',
      ),
    );
    expect(claim.status).toBe(200);

    const reviewer = await POST(
      await multipart(tokenOne, { task: taskId, file: textFile('x') }),
    );
    expect(reviewer.status).toBe(201);
    expect(bucket.objects.size).toBe(1);

    const owner = await POST(
      await multipart(tokenTwo, { task: taskId, file: textFile('x') }),
    );
    expect(owner.status).toBe(201);
  });

  it('does not resolve task refs or attachments from another project', async () => {
    const now = 1_700_000_000_000;
    database.sqlite
      .prepare(
        'INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('project-2', 'Project Two', 'project-two', 'user-1', now, now);
    database.sqlite
      .prepare(
        `INSERT INTO tasks
        (id, project_id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
       VALUES ('foreign-task-1', 'project-2', 'Foreign', '', '产品', 'user-1', 'alice', 'Alice', NULL, NULL, 'ideas', 0, ?, ?, 'user-1')`,
      )
      .run(now, now);
    const foreign = await createTaskAttachment({
      projectId: 'project-2',
      taskId: 'foreign-task-1',
      objectKey: 'foreign-object',
      fileName: 'secret.txt',
      contentType: 'text/plain',
      size: 1,
      createdBy: 'user-1',
    });
    bucket.objects.set('foreign-object', { bytes: new Uint8Array([1]).buffer });

    const upload = await POST(
      await multipart(tokenOne, {
        task: 'foreign-task-1',
        file: textFile('x'),
      }),
    );
    expect(upload.status).toBe(404);
    expect(bucket.objects.size).toBe(1);

    const list = await GET(getRequest(tokenOne, 'task=foreign-task-1'));
    expect(list.status).toBe(404);
    const download = await GET(getRequest(tokenOne, `id=${foreign!.id}`));
    expect(download.status).toBe(404);
  });

  it('requires multipart form data with a task ref and a file', async () => {
    const json = await POST(
      new Request(`${origin}/api/v1/attachments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenOne}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(json.status).toBe(415);

    const missingTask = await POST(
      await multipart(tokenOne, { file: textFile('x') }),
    );
    expect(missingTask.status).toBe(400);
    const missingFile = await POST(await multipart(tokenOne, { task: taskId }));
    expect(missingFile.status).toBe(400);
  });

  it('keeps the browser upload route session-only and same-origin', async () => {
    const bearerOnly = await webPOST(
      await multipart(tokenOne, {
        projectId: 'project-1',
        taskId,
        file: textFile('x'),
      }),
    );
    expect(bearerOnly.status).toBe(403);

    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const crossSite = await webPOST(
      await multipart(
        null,
        { projectId: 'project-1', taskId, file: textFile('x') },
        {
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: 'https://evil.test',
        },
      ),
    );
    expect(crossSite.status).toBe(403);

    const browser = await webPOST(
      await multipart(
        null,
        { projectId: 'project-1', taskId, file: textFile('browser') },
        { Cookie: `${SESSION_COOKIE}=${session}`, Origin: origin },
      ),
    );
    const payload = (await browser.json()) as {
      attachment: { name: string; url: string };
    };
    expect(browser.status).toBe(201);
    expect(payload.attachment.name).toBe('notes.txt');
    expect(payload.attachment.url).toMatch(/^\/api\/attachments\?id=/);
    expect(bucket.objects.size).toBe(1);
  });

  it('drives attach, attachments, and download through the CLI', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'kanby-attach-cli-'));
    const received: Array<{ method: string; length: string | undefined }> = [];
    let server: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      server = createServer((incoming, outgoing) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', async () => {
          received.push({
            method: incoming.method ?? '',
            length: incoming.headers['content-length'],
          });
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (typeof value === 'string') headers.set(name, value);
          const request = new Request(`${origin}${incoming.url}`, {
            method: incoming.method,
            headers,
            body: incoming.method === 'GET' ? undefined : Buffer.concat(chunks),
          });
          const handler = incoming.method === 'POST' ? POST : GET;
          const response = await handler(request);
          outgoing.writeHead(
            response.status,
            Object.fromEntries(response.headers.entries()),
          );
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        });
      }).listen(0, '127.0.0.1', () => {
        const address = server!.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const environment = {
      ...process.env,
      XDG_CONFIG_HOME: workspace,
      KANBY_TOKEN: tokenOne,
      KANBY_URL: `http://127.0.0.1:${port}`,
    };
    try {
      const source = join(workspace, 'report.md');
      writeFileSync(source, '# Evidence\n');
      const attached = await runCli(
        ['task', 'attach', taskId, source, '--json'],
        environment,
        workspace,
      );
      expect(attached.stderr).toBe('');
      expect(attached.status).toBe(0);
      const attachment = JSON.parse(attached.stdout) as {
        id: string;
        name: string;
        contentType: string;
        size: number;
      };
      expect(attachment).toMatchObject({
        name: 'report.md',
        contentType: 'text/markdown',
        size: 11,
      });
      expect(received[0]).toEqual({
        method: 'POST',
        length: expect.any(String),
      });

      const listed = await runCli(
        ['task', 'attachments', taskId],
        environment,
        workspace,
      );
      expect(listed.status).toBe(0);
      expect(listed.stdout).toContain(attachment.id);
      expect(listed.stdout).toContain('report.md');

      const downloads = join(workspace, 'downloads');
      mkdirSync(downloads);
      const downloaded = await runCli(
        ['task', 'download', attachment.id],
        environment,
        downloads,
      );
      expect(downloaded.stderr).toBe('');
      expect(downloaded.status).toBe(0);
      const target = join(downloads, 'report.md');
      expect(readFileSync(target, 'utf8')).toBe('# Evidence\n');

      writeFileSync(target, 'local edit');
      const refused = await runCli(
        ['task', 'download', attachment.id],
        environment,
        downloads,
      );
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('already exists');
      expect(readFileSync(target, 'utf8')).toBe('local edit');

      writeFileSync(join(workspace, 'empty.txt'), '');
      const empty = await runCli(
        ['task', 'attach', taskId, join(workspace, 'empty.txt')],
        environment,
        workspace,
      );
      expect(empty.status).toBe(1);
      expect(received).toHaveLength(4);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function runCli(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
) {
  const cli = join(process.cwd(), 'packages/cli/bin/kanby.js');
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...arguments_], {
        env: environment,
        cwd,
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
