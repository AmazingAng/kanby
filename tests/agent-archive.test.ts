import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATCH } from '@/app/api/v1/tasks/route';
import { listTasks } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  agentRequest,
  configureEnvironment,
  seedAgentToken,
  seedProject,
  seedTask,
} from './support/fixtures';

describe('Agent task archive API', () => {
  let database: TestD1Database;
  let token: string;

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

  afterEach(() => database.close());

  it('archives an active task and records Agent-attributed activity', async () => {
    const task = seedTask(database);
    expect(
      (
        await PATCH(
          agentRequest(
            token,
            { id: task.id, action: 'claim', leaseMinutes: 15 },
            'claim-before-own-archive',
          ),
        )
      ).status,
    ).toBe(200);
    const response = await PATCH(
      agentRequest(
        token,
        { id: task.id, action: 'archive' },
        'archive-active-task',
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { id: task.id, archivedAt: expect.any(Number) },
    });
    expect(await listTasks('project-1')).toHaveLength(0);
    expect((await listTasks('project-1', true)).map((item) => item.id)).toEqual(
      [task.id],
    );
    expect(
      database.sqlite
        .prepare(
          'SELECT COUNT(*) AS count FROM task_agent_claims WHERE task_id = ?',
        )
        .get(task.id),
    ).toEqual({ count: 0 });
    expect(
      database.sqlite
        .prepare(
          "SELECT source, actor_id, actor_name, kind FROM task_events WHERE task_id = ? AND kind = 'task.archived'",
        )
        .get(task.id),
    ).toMatchObject({
      source: 'agent',
      actor_id: '55555555-5555-4555-8555-555555555555',
      actor_name: 'Alice / Codex',
      kind: 'task.archived',
    });
  });

  it('replays an archive idempotently without duplicate activity', async () => {
    const task = seedTask(database);
    const request = () =>
      agentRequest(
        token,
        { id: task.id, action: 'archive' },
        'archive-idempotent-task',
      );

    const first = await PATCH(request());
    const second = await PATCH(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = 'task.archived'",
        )
        .get(task.id),
    ).toEqual({ count: 1 });
  });

  it('rejects archive while another Agent owns the active claim', async () => {
    const task = seedTask(database);
    const otherToken = seedAgentToken(
      database,
      '66666666-6666-4666-8666-666666666666',
      'd'.repeat(48),
      'Bob / Codex',
    );
    expect(
      (
        await PATCH(
          agentRequest(
            otherToken,
            { id: task.id, action: 'claim', leaseMinutes: 15 },
            'other-agent-claims-before-archive',
          ),
        )
      ).status,
    ).toBe(200);

    const response = await PATCH(
      agentRequest(
        token,
        { id: task.id, action: 'archive' },
        'blocked-agent-archive',
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'claimed_by_another_agent' },
    });
    expect((await listTasks('project-1')).map((item) => item.id)).toEqual([
      task.id,
    ]);
    expect(await listTasks('project-1', true)).toHaveLength(0);
  });

  it('does not resolve a task from another project', async () => {
    const now = 1_700_000_000_000;
    database.sqlite
      .prepare(
        'INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('project-2', 'Project Two', 'project-two', 'user-1', now, now);
    database.sqlite
      .prepare(
        'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run('project-2', 'user-1', 'owner', now);
    database.sqlite
      .prepare(
        `INSERT INTO tasks
        (id, project_id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
       VALUES (?, 'project-2', 'Foreign task', '', '产品', 'user-1', 'alice', 'Alice', NULL, NULL, 'ideas', 0, ?, ?, 'user-1')`,
      )
      .run('foreign-task-0001', now, now);

    const response = await PATCH(
      agentRequest(
        token,
        { id: 'foreign-task-0001', action: 'archive' },
        'foreign-project-archive',
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_found' },
    });
    expect((await listTasks('project-2')).map((item) => item.id)).toEqual([
      'foreign-task-0001',
    ]);
  });
});
