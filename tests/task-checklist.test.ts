import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DELETE, PATCH, POST } from '@/app/api/task-checklist/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { listTasks } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

describe('task acceptance checklist', () => {
  let database: TestD1Database;
  let session: string;
  const initialRevision = 1_700_000_000_000;

  beforeEach(async () => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedTask(database, { updatedAt: initialRevision });
    session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
  });

  afterEach(() => database.close());

  function request(
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    options: { cookie?: boolean; requestOrigin?: string } = {},
  ) {
    return new Request(`${origin}/api/task-checklist`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.cookie === false
          ? {}
          : { Cookie: `${SESSION_COOKIE}=${session}` }),
        Origin: options.requestOrigin ?? origin,
      },
      body: JSON.stringify(body),
    });
  }

  const createBody = {
    projectId: 'project-1',
    taskId: 'task-00000001',
    body: '登录后能创建项目',
    taskUpdatedAt: initialRevision,
  };

  it('creates, renames, completes, and deletes an acceptance criterion', async () => {
    const createdResponse = await POST(request('POST', createBody));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      acceptanceCriteria: Array<{
        id: string;
        body: string;
        completed: boolean;
        position: number;
        updatedAt: number;
      }>;
      taskUpdatedAt: number;
    };
    expect(created.acceptanceCriteria).toHaveLength(1);
    expect(created.acceptanceCriteria[0]).toMatchObject({
      body: '登录后能创建项目',
      completed: false,
      position: 0,
    });
    expect(created.taskUpdatedAt).toBeGreaterThan(initialRevision);

    const criterion = created.acceptanceCriteria[0]!;
    const updatedResponse = await PATCH(
      request('PATCH', {
        projectId: 'project-1',
        taskId: 'task-00000001',
        id: criterion.id,
        body: '登录后可以创建项目',
        completed: true,
        updatedAt: criterion.updatedAt,
        taskUpdatedAt: created.taskUpdatedAt,
      }),
    );
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()) as typeof created;
    expect(updated.acceptanceCriteria[0]).toMatchObject({
      body: '登录后可以创建项目',
      completed: true,
    });
    expect(updated.taskUpdatedAt).toBeGreaterThan(created.taskUpdatedAt);

    const deleteResponse = await DELETE(
      request('DELETE', {
        projectId: 'project-1',
        taskId: 'task-00000001',
        id: criterion.id,
        updatedAt: updated.acceptanceCriteria[0]!.updatedAt,
        taskUpdatedAt: updated.taskUpdatedAt,
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toMatchObject({
      acceptanceCriteria: [],
    });
    expect(
      database.sqlite
        .prepare(
          "SELECT kind FROM task_events WHERE kind LIKE 'acceptance.%' ORDER BY created_at, rowid",
        )
        .all()
        .map((row) => (row as { kind: string }).kind),
    ).toEqual([
      'acceptance.created',
      'acceptance.completed',
      'acceptance.deleted',
    ]);
    expect(
      database.sqlite
        .prepare("SELECT status FROM tasks WHERE id = 'task-00000001'")
        .get(),
    ).toEqual({ status: 'ideas' });
  });

  it('rejects unauthenticated, cross-origin, malformed, stale, and foreign-project writes', async () => {
    expect(
      (await POST(request('POST', createBody, { cookie: false }))).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request('POST', createBody, {
            requestOrigin: 'https://evil.example',
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(request('POST', { ...createBody, body: ' ' }))).status,
    ).toBe(400);
    expect(
      (await POST(request('POST', { ...createBody, body: 'x'.repeat(241) })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request('POST', { ...createBody, unexpected: 'ignored?' })))
        .status,
    ).toBe(400);

    const created = await POST(request('POST', createBody));
    expect(created.status).toBe(201);
    expect((await POST(request('POST', createBody))).status).toBe(409);

    const now = initialRevision + 100;
    database.sqlite
      .prepare(
        'INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('project-2', 'Project Two', 'project-two', 'user-1', now, now);
    database.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('project-2', 'user-1', 'owner', ?)",
      )
      .run(now);
    expect(
      (await POST(request('POST', { ...createBody, projectId: 'project-2' })))
        .status,
    ).toBe(404);
  });

  it('allows exactly one concurrent update for the same revisions', async () => {
    const createdResponse = await POST(request('POST', createBody));
    const created = (await createdResponse.json()) as {
      acceptanceCriteria: Array<{ id: string; updatedAt: number }>;
      taskUpdatedAt: number;
    };
    const item = created.acceptanceCriteria[0]!;
    const update = (body: string) =>
      PATCH(
        request('PATCH', {
          projectId: 'project-1',
          taskId: 'task-00000001',
          id: item.id,
          body,
          updatedAt: item.updatedAt,
          taskUpdatedAt: created.taskUpdatedAt,
        }),
      );
    const [first, second] = await Promise.all([
      update('方案 A'),
      update('方案 B'),
    ]);
    expect(
      [first.status, second.status].sort((left, right) => left - right),
    ).toEqual([200, 409]);
  });

  it('enforces the twenty-item limit without changing the task', async () => {
    const statement = database.sqlite.prepare(
      `INSERT INTO task_acceptance_items
       (id, project_id, task_id, body, completed, position, created_by, created_at, updated_at)
       VALUES (?, 'project-1', 'task-00000001', ?, 0, ?, 'user-1', ?, ?)`,
    );
    for (let index = 0; index < 20; index += 1)
      statement.run(
        `criterion-${index}`,
        `条件 ${index + 1}`,
        index,
        initialRevision + index,
        initialRevision + index,
      );
    const response = await POST(request('POST', createBody));
    expect(response.status).toBe(409);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_acceptance_items WHERE task_id = 'task-00000001'",
        )
        .get(),
    ).toEqual({ count: 20 });
    expect(
      database.sqlite
        .prepare("SELECT updated_at FROM tasks WHERE id = 'task-00000001'")
        .get(),
    ).toEqual({ updated_at: initialRevision });
  });

  it('returns ordered criteria on task reads and cascades them on task deletion', async () => {
    database.sqlite.exec('PRAGMA foreign_keys = ON');
    const statement = database.sqlite.prepare(
      `INSERT INTO task_acceptance_items
       (id, project_id, task_id, body, completed, position, created_by, created_at, updated_at)
       VALUES (?, 'project-1', 'task-00000001', ?, ?, ?, 'user-1', ?, ?)`,
    );
    statement.run(
      'criterion-b',
      '第二项',
      1,
      1,
      initialRevision + 2,
      initialRevision + 2,
    );
    statement.run(
      'criterion-a',
      '第一项',
      0,
      0,
      initialRevision + 1,
      initialRevision + 1,
    );

    const [task] = await listTasks('project-1');
    expect(task?.acceptanceCriteria).toMatchObject([
      { id: 'criterion-a', body: '第一项', completed: false },
      { id: 'criterion-b', body: '第二项', completed: true },
    ]);

    database.sqlite
      .prepare("DELETE FROM tasks WHERE id = 'task-00000001'")
      .run();
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM task_acceptance_items')
        .get(),
    ).toEqual({ count: 0 });
  });
});
