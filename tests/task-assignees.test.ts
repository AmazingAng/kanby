import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as agentGet } from '@/app/api/v1/tasks/route';
import { POST as splitTaskRoute } from '@/app/api/tasks/split/route';
import { POST as createTaskRoute, PUT } from '@/app/api/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { listTasks, updateTask } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

describe('multi-assignee tasks', () => {
  let database: TestD1Database;
  let session: string;
  const initialRevision = 1_700_000_000_000;

  beforeEach(async () => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedTask(database, { updatedAt: initialRevision });
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('user-2', 'bob', 'Bob', 'https://example.test/bob.png', 1, 1);
    database.sqlite
      .prepare(
        'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run('project-1', 'user-2', 'member', 1);
    session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  function addUser(
    id: string,
    login: string,
    projectId: string | null = 'project-1',
  ) {
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, login, login[0]!.toUpperCase() + login.slice(1), null, 1, 1);
    if (projectId) {
      database.sqlite
        .prepare(
          'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(projectId, id, 'member', 1);
    }
  }

  function updateRequest(ownerIds: string[], updatedAt = initialRevision) {
    return new Request(`${origin}/api/tasks`, {
      method: 'PUT',
      headers: {
        Cookie: `${SESSION_COOKIE}=${session}`,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: 'project-1',
        id: 'task-00000001',
        title: 'Shared task',
        note: 'Alice and Bob own this together',
        tag: '代码',
        ownerIds,
        due: 'Friday',
        status: 'building',
        updatedAt,
      }),
    });
  }

  it('assigns multiple project members atomically while preserving owner compatibility', async () => {
    const response = await PUT(updateRequest(['user-1', 'user-2']));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      task: {
        owner: { id: string; login: string };
        owners: Array<{ id: string; login: string }>;
        updatedAt: number;
      };
    };
    expect(payload.task.owner).toMatchObject({ id: 'user-1', login: 'alice' });
    expect(payload.task.owners).toMatchObject([
      { id: 'user-1', login: 'alice' },
      { id: 'user-2', login: 'bob' },
    ]);
    expect(payload.task.updatedAt).toBeGreaterThan(initialRevision);
  });

  it('reads legacy owners and backfills them idempotently', async () => {
    expect((await listTasks('project-1'))[0]).toMatchObject({
      owner: { id: 'user-1' },
      owners: [{ id: 'user-1' }],
    });

    const backfill = readFileSync('tools/backfill-task-assignees.sql', 'utf8');
    database.sqlite.exec(backfill);
    database.sqlite.exec(backfill);

    expect(
      database.sqlite
        .prepare(
          "SELECT project_id, task_id, user_id, position FROM task_assignees WHERE task_id = 'task-00000001'",
        )
        .all(),
    ).toEqual([
      {
        project_id: 'project-1',
        task_id: 'task-00000001',
        user_id: 'user-1',
        position: 0,
      },
    ]);
  });

  it('rejects invalid and foreign assignees without partial writes', async () => {
    addUser('user-3', 'cara');
    addUser('user-4', 'drew');
    database.sqlite
      .prepare(
        'INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('project-2', 'Other', 'other', 'user-5', 1, 1);
    addUser('user-5', 'erin', 'project-2');

    const responses = await Promise.all([
      PUT(updateRequest([])),
      PUT(updateRequest(['user-1', 'user-1'])),
      PUT(updateRequest(['user-1', 'user-2', 'user-3', 'user-4'])),
      PUT(updateRequest(['missing-user'])),
      PUT(updateRequest(['user-5'])),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 400, 404, 404,
    ]);
    await expect(
      updateTask('project-1', {
        id: 'task-00000001',
        title: 'Bypass route validation',
        note: '',
        tag: '代码',
        ownerId: 'user-1',
        ownerIds: ['user-1', 'user-2', 'user-3', 'user-4'],
        status: 'building',
        expectedUpdatedAt: initialRevision,
      }),
    ).resolves.toBeNull();
    expect(
      database.sqlite
        .prepare(
          "SELECT title, owner_id, updated_at FROM tasks WHERE id = 'task-00000001'",
        )
        .get(),
    ).toEqual({
      title: 'Original',
      owner_id: 'user-1',
      updated_at: initialRevision,
    });
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_assignees WHERE task_id = 'task-00000001'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('allows exactly one same-revision assignee update without loser side effects', async () => {
    addUser('user-3', 'cara');
    const initial = await PUT(updateRequest(['user-1', 'user-2']));
    const firstPayload = (await initial.json()) as {
      task: { updatedAt: number };
    };
    vi.spyOn(Date, 'now').mockReturnValue(firstPayload.task.updatedAt + 1);

    const [left, right] = await Promise.all([
      PUT(updateRequest(['user-1', 'user-3'], firstPayload.task.updatedAt)),
      PUT(updateRequest(['user-2', 'user-3'], firstPayload.task.updatedAt)),
    ]);
    expect(
      [left.status, right.status].sort(
        (leftStatus, rightStatus) => leftStatus - rightStatus,
      ),
    ).toEqual([200, 409]);
    const winner = (await (left.status === 200 ? left : right).json()) as {
      task: { owners: Array<{ id: string }> };
    };
    expect(
      (await listTasks('project-1'))[0]?.owners.map((owner) => owner.id),
    ).toEqual(winner.task.owners.map((owner) => owner.id));
  });

  it('stores the creator on new tasks and preserves every owner when splitting', async () => {
    const created = await createTaskRoute(
      new Request(`${origin}/api/tasks`, {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: 'project-1',
          title: 'New task',
          status: 'ideas',
        }),
      }),
    );
    expect(created.status).toBe(201);
    const createdPayload = (await created.json()) as {
      task: { id: string; owners: Array<{ id: string }> };
    };
    expect(createdPayload.task.owners.map((owner) => owner.id)).toEqual([
      'user-1',
    ]);

    const assigned = await PUT(updateRequest(['user-1', 'user-2']));
    const assignedPayload = (await assigned.json()) as {
      task: { updatedAt: number };
    };
    const split = await splitTaskRoute(
      new Request(`${origin}/api/tasks/split`, {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: 'project-1',
          parentTaskId: 'task-00000001',
          parentUpdatedAt: assignedPayload.task.updatedAt,
          titles: ['Child one', 'Child two'],
        }),
      }),
    );
    expect(split.status).toBe(201);
    const splitPayload = (await split.json()) as {
      tasks: Array<{ owners: Array<{ id: string }> }>;
    };
    expect(
      splitPayload.tasks.map((task) => task.owners.map((owner) => owner.id)),
    ).toEqual([
      ['user-1', 'user-2'],
      ['user-1', 'user-2'],
    ]);
  });

  it('exposes ordered owners to Agents and cascades assignment deletion', async () => {
    const assigned = await PUT(updateRequest(['user-1', 'user-2']));
    expect(assigned.status).toBe(200);
    const token = seedAgentToken(
      database,
      '11111111-1111-4111-8111-111111111111',
      'm'.repeat(48),
      'Multi-owner Agent',
    );
    const agentResponse = await agentGet(
      new Request(`${origin}/api/v1/tasks?id=task-00000001`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(agentResponse.status).toBe(200);
    const agentPayload = (await agentResponse.json()) as {
      data: { owner: { id: string }; owners: Array<{ id: string }> };
    };
    expect(agentPayload.data.owner.id).toBe('user-1');
    expect(agentPayload.data.owners.map((owner) => owner.id)).toEqual([
      'user-1',
      'user-2',
    ]);

    database.sqlite.exec('PRAGMA foreign_keys = ON');
    database.sqlite
      .prepare("DELETE FROM tasks WHERE id = 'task-00000001'")
      .run();
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_assignees WHERE task_id = 'task-00000001'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });
});
