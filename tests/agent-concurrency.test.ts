import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST, PATCH } from '@/app/api/v1/tasks/route';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  agentRequest,
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
} from './support/fixtures';

const tokenOneId = '11111111-1111-4111-8111-111111111111';
const tokenTwoId = '22222222-2222-4222-8222-222222222222';
const tokenSecret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';

describe('Agent mutation coordination', () => {
  let database: TestD1Database;
  let tokenOne: string;
  let tokenTwo: string;

  beforeAll(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    tokenOne = seedAgentToken(database, tokenOneId, tokenSecret, 'agent-one');
    tokenTwo = seedAgentToken(database, tokenTwoId, tokenSecret, 'agent-two');
  });

  afterAll(() => database.close());

  it('executes only one concurrent create for one idempotency key', async () => {
    const request = () =>
      new Request(`${origin}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenOne}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'same-create-key',
        },
        body: JSON.stringify({ title: 'Only once', status: 'ideas' }),
      });

    const responses = await Promise.all([POST(request()), POST(request())]);
    const count = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = 'Only once'")
      .get() as { count: number };

    const successful = responses.filter((response) => response.status < 300);
    const successfulPayloads = await Promise.all(
      successful.map(
        (response) => response.json() as Promise<{ data: { id: string } }>,
      ),
    );
    expect(Number(count.count)).toBe(1);
    expect(successful.length).toBeGreaterThanOrEqual(1);
    expect(
      new Set(successfulPayloads.map((payload) => payload.data.id)).size,
    ).toBe(1);
    expect(
      responses.every(
        (response) => response.status === 201 || response.status === 409,
      ),
    ).toBe(true);
  });

  it('rejects reusing an idempotency key with a different payload', async () => {
    const request = (title: string) =>
      new Request(`${origin}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenOne}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'payload-conflict-key',
        },
        body: JSON.stringify({ title, status: 'ideas' }),
      });

    expect((await POST(request('First payload'))).status).toBe(201);
    const conflict = await POST(request('Different payload'));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      ok: false,
      error: { code: 'idempotency_conflict' },
    });
  });

  it('releases the key when the request fails so a retry can succeed', async () => {
    const request = () =>
      new Request(`${origin}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenOne}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'failing-create-key',
        },
        body: JSON.stringify({ title: 'Retry me', status: 'ideas' }),
      });
    database.exec(
      "CREATE TRIGGER fail_task_insert BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    await expect(POST(request())).rejects.toThrow('boom');
    database.exec('DROP TRIGGER fail_task_insert');

    expect((await POST(request())).status).toBe(201);
  });

  it('takes over a pending key abandoned by a dead request and expires old keys', async () => {
    const body = JSON.stringify({ title: 'Abandoned', status: 'ideas' });
    const { createHash } = await import('node:crypto');
    const requestHash = createHash('sha256').update(body).digest('hex');
    const now = Date.now();
    const insert = database.sqlite.prepare(
      'INSERT INTO agent_idempotency_keys (token_id, key, operation, response_json, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run(
      tokenOneId,
      'abandoned-key',
      'task:create',
      JSON.stringify({
        __kanbyIdempotency: 1,
        state: 'pending',
        requestHash,
        ownerNonce: 'dead',
      }),
      now - 10 * 60 * 1000,
    );
    insert.run(
      tokenOneId,
      'ancient-key',
      'task:create',
      '{}',
      now - 2 * 86_400_000,
    );

    const response = await POST(
      new Request(`${origin}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenOne}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'abandoned-key',
        },
        body,
      }),
    );
    expect(response.status).toBe(201);
    expect(
      database.sqlite
        .prepare(
          "SELECT key FROM agent_idempotency_keys WHERE key IN ('abandoned-key', 'ancient-key')",
        )
        .all(),
    ).toEqual([{ key: 'abandoned-key' }]);
  });

  it('does not let another Agent Token complete a claimed task', async () => {
    const task = seedTask(database, { id: 'task-claimed' });
    expect(
      (
        await PATCH(
          agentRequest(
            tokenOne,
            { id: task.id, action: 'claim', leaseMinutes: 15 },
            'claim-task-key',
          ),
        )
      ).status,
    ).toBe(200);

    const blocked = await PATCH(
      agentRequest(
        tokenTwo,
        { id: task.id, action: 'complete' },
        'complete-task-key',
      ),
    );
    const stored = database.sqlite
      .prepare('SELECT status FROM tasks WHERE id = ?')
      .get(task.id) as { status: string };

    expect(blocked.status).toBe(409);
    expect(stored.status).toBe('ideas');

    const owner = await PATCH(
      agentRequest(
        tokenOne,
        { id: task.id, action: 'update', title: 'Claimed edit' },
        'owner-update-key',
      ),
    );
    expect(owner.status).toBe(200);
  });

  it('lets a reviewing Agent Token record progress while another holds the claim', async () => {
    const task = seedTask(database, { id: 'task-progress-claimed' });
    expect(
      (
        await PATCH(
          agentRequest(
            tokenOne,
            { id: task.id, action: 'claim' },
            'claim-progress-key',
          ),
        )
      ).status,
    ).toBe(200);

    const blocked = await PATCH(
      agentRequest(
        tokenTwo,
        { id: task.id, action: 'progress', message: 'review note' },
        'blocked-progress-key',
      ),
    );
    const allowed = await PATCH(
      agentRequest(
        tokenOne,
        { id: task.id, action: 'progress', message: 'owner update' },
        'owner-progress-key',
      ),
    );
    const updates = database.sqlite
      .prepare(
        "SELECT message FROM task_agent_updates WHERE task_id = ? AND kind = 'progress' ORDER BY created_at, message",
      )
      .all(task.id) as { message: string }[];
    const claim = database.sqlite
      .prepare('SELECT token_id FROM task_agent_claims WHERE task_id = ?')
      .get(task.id) as { token_id: string };

    expect(blocked.status).toBe(200);
    expect(allowed.status).toBe(200);
    expect(updates.map((update) => update.message).sort()).toEqual([
      'owner update',
      'review note',
    ]);
    expect(claim.token_id).toBe(tokenOneId);
  });

  it('releases an idempotency reservation after validation rejects the request', async () => {
    const task = seedTask(database, { id: 'task-invalid-action' });
    const request = () =>
      agentRequest(
        tokenOne,
        { id: task.id, action: 'unknown' },
        'invalid-action-key',
      );

    expect((await PATCH(request())).status).toBe(400);
    expect((await PATCH(request())).status).toBe(400);
  });

  it('rejects malformed and oversized JSON without creating a task', async () => {
    const before = database.sqlite
      .prepare('SELECT COUNT(*) AS count FROM tasks')
      .get() as { count: number };
    const request = (body: string) =>
      new Request(`${origin}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenOne}`,
          'Content-Type': 'application/json',
        },
        body,
      });

    const malformed = await POST(request('{'));
    const oversized = await POST(
      request(JSON.stringify({ title: 'x', padding: 'x'.repeat(65 * 1024) })),
    );
    const after = database.sqlite
      .prepare('SELECT COUNT(*) AS count FROM tasks')
      .get() as { count: number };

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: 'invalid_json' },
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      error: { code: 'payload_too_large' },
    });
    expect(Number(after.count)).toBe(Number(before.count));
  });
});
