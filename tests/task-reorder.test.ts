import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATCH, PUT } from '@/app/api/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { reorderTasks } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  sessionSecret,
} from './support/fixtures';

const actor = {
  actorId: 'user-1',
  actorName: 'Alice',
  actorLogin: 'alice',
  actorAvatarUrl: null,
};

function insertTask(
  database: TestD1Database,
  id: string,
  status: string,
  position: number,
  updatedAt = 1_000,
) {
  database.sqlite
    .prepare(
      `INSERT INTO tasks
      (id, project_id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
     VALUES (?, 'project-1', ?, '', '产品', 'user-1', 'alice', 'Alice', NULL, NULL, ?, ?, 1, ?, 'user-1')`,
    )
    .run(id, id, status, position, updatedAt);
}

function row(database: TestD1Database, id: string) {
  return database.sqlite
    .prepare('SELECT status, position, updated_at FROM tasks WHERE id = ?')
    .get(id) as { status: string; position: number; updated_at: number };
}

async function browser(method: 'PATCH' | 'PUT', body: unknown) {
  const session = await createSessionToken(
    { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
    sessionSecret,
  );
  const request = new Request(`${origin}/api/tasks`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE}=${session}`,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  return method === 'PATCH' ? PATCH(request) : PUT(request);
}

describe('drag reorder', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => database.close());

  it('never moves a neighbour that changed column elsewhere and keeps neighbour revisions', async () => {
    insertTask(database, 'a', 'ideas', 0);
    insertTask(database, 'b', 'ideas', 1, 2_000);
    insertTask(database, 'c', 'ideas', 2, 3_000);
    // Someone else moved "c" to building after our client loaded the board.
    database.sqlite
      .prepare(
        "UPDATE tasks SET status = 'building', position = 0 WHERE id = 'c'",
      )
      .run();

    const response = await browser('PATCH', {
      projectId: 'project-1',
      movedTaskId: 'a',
      expectedUpdatedAt: 1_000,
      items: [
        { id: 'b', status: 'ideas', position: 0 },
        { id: 'c', status: 'ideas', position: 1 },
        { id: 'a', status: 'ideas', position: 2 },
      ],
    });

    expect(response.status).toBe(200);
    expect(row(database, 'a')).toMatchObject({ status: 'ideas', position: 2 });
    expect(row(database, 'b')).toEqual({
      status: 'ideas',
      position: 0,
      updated_at: 2_000,
    });
    expect(row(database, 'c')).toEqual({
      status: 'building',
      position: 0,
      updated_at: 3_000,
    });
  });

  it('does not lock an editor of a neighbour whose position shifted', async () => {
    insertTask(database, 'a', 'ideas', 0);
    insertTask(database, 'b', 'ideas', 1, 2_000);

    expect(
      (
        await browser('PATCH', {
          projectId: 'project-1',
          movedTaskId: 'a',
          expectedUpdatedAt: 1_000,
          items: [
            { id: 'b', status: 'ideas', position: 0 },
            { id: 'a', status: 'ideas', position: 1 },
          ],
        })
      ).status,
    ).toBe(200);

    // The editor of "b" still holds revision 2000 and its autosave succeeds.
    const save = await browser('PUT', {
      projectId: 'project-1',
      id: 'b',
      title: 'b edited',
      note: '',
      tag: '产品',
      ownerIds: ['user-1'],
      status: 'ideas',
      updatedAt: 2_000,
    });
    expect(save.status).toBe(200);
    expect(row(database, 'b').position).toBe(0);
  });

  it('rejects a stale moved card with 409 and applies nothing', async () => {
    insertTask(database, 'a', 'ideas', 0, 5_000);
    insertTask(database, 'b', 'ideas', 1, 2_000);

    const response = await browser('PATCH', {
      projectId: 'project-1',
      movedTaskId: 'a',
      expectedUpdatedAt: 4_000,
      items: [
        { id: 'b', status: 'ideas', position: 0 },
        { id: 'a', status: 'building', position: 0 },
      ],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ currentUpdatedAt: 5_000 });
    expect(row(database, 'a')).toMatchObject({ status: 'ideas', position: 0 });
    expect(row(database, 'b').position).toBe(1);
  });

  it('bumps the moved card revision only on a column change and returns it', async () => {
    insertTask(database, 'a', 'ideas', 0, 1_000);

    const response = await browser('PATCH', {
      projectId: 'project-1',
      movedTaskId: 'a',
      expectedUpdatedAt: 1_000,
      items: [{ id: 'a', status: 'building', position: 0 }],
    });
    const payload = (await response.json()) as {
      movedTask: { id: string; updatedAt: number };
    };

    expect(response.status).toBe(200);
    expect(payload.movedTask.id).toBe('a');
    expect(payload.movedTask.updatedAt).toBeGreaterThan(1_000);
    expect(row(database, 'a')).toMatchObject({
      status: 'building',
      updated_at: payload.movedTask.updatedAt,
    });
    const moved = database.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM task_events WHERE kind = 'task.moved'",
      )
      .get() as { n: number };
    expect(moved.n).toBe(1);
  });

  it('keeps large columns under the D1 parameter limit', async () => {
    const items = [];
    for (let index = 0; index < 150; index += 1) {
      insertTask(database, `t${index}`, 'ideas', index);
      items.push({
        id: `t${index}`,
        status: 'ideas' as const,
        position: 149 - index,
      });
    }
    await reorderTasks('project-1', items, {
      movedTaskId: 't0',
      actor,
      expectedUpdatedAt: 1_000,
    });
    expect(row(database, 't0').position).toBe(149);
    expect(row(database, 't149').position).toBe(0);
    expect(row(database, 't149').updated_at).toBe(1_000);
  });

  it('rejects an expected revision without a moved card', async () => {
    const response = await browser('PATCH', {
      projectId: 'project-1',
      expectedUpdatedAt: 1_000,
      items: [],
    });
    expect(response.status).toBe(400);
  });
});
