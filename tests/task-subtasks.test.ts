import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DELETE as deleteTaskRoute } from '@/app/api/tasks/route';
import { POST as splitTaskRoute } from '@/app/api/tasks/split/route';
import { PATCH as agentTaskRoute } from '@/app/api/v1/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  listTasks,
  permanentlyDeleteArchivedTask,
  setTaskArchived,
} from '@/lib/db';
import {
  acceptanceProgress,
  clearStarterTaskNote,
  groupSameColumnTaskFamilies,
  STARTER_TASK_NOTE,
  subtaskProgress,
  taskHierarchyKind,
} from '@/lib/task-subtasks';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

describe('task subtasks and card splitting', () => {
  let database: TestD1Database;
  let session: string;

  beforeEach(async () => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedTask(database, { title: 'Ship onboarding' });
    database.sqlite
      .prepare(
        "UPDATE tasks SET tag = '设计', due = '周五', status = 'building' WHERE id = 'task-00000001'",
      )
      .run();
    session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
  });

  afterEach(() => database.close());

  function request(
    body: unknown,
    options: { cookie?: boolean; requestOrigin?: string } = {},
  ) {
    return new Request(`${origin}/api/tasks/split`, {
      method: 'POST',
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

  const validBody = {
    projectId: 'project-1',
    parentTaskId: 'task-00000001',
    parentUpdatedAt: 1_700_000_000_000,
    titles: ['设计空状态', '接入 GitHub 登录'],
  };

  it('splits a top-level card into independently actionable child cards', async () => {
    const response = await splitTaskRoute(request(validBody));
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      parentUpdatedAt: number;
      tasks: Array<{
        id: string;
        title: string;
        tag: string;
        due?: string;
        status: string;
        owner: { id: string };
        parent?: { id: string; title: string; archived: boolean };
      }>;
    };

    expect(payload.parentUpdatedAt).toBeGreaterThan(validBody.parentUpdatedAt);
    expect(payload.tasks).toHaveLength(2);
    expect(payload.tasks.map((task) => task.title)).toEqual(validBody.titles);
    for (const task of payload.tasks) {
      expect(task).toMatchObject({
        tag: '设计',
        due: '周五',
        status: 'ideas',
        owner: { id: 'user-1' },
        parent: {
          id: 'task-00000001',
          title: 'Ship onboarding',
          archived: false,
        },
      });
    }

    const persisted = await listTasks('project-1');
    expect(persisted).toHaveLength(3);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_events WHERE kind = 'task.split' AND task_id = 'task-00000001'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM task_events WHERE kind = 'task.created' AND task_id != 'task-00000001'",
        )
        .get(),
    ).toEqual({ count: 2 });
  });

  it('allows only one concurrent split at the same parent revision', async () => {
    const [first, second] = await Promise.all([
      splitTaskRoute(request(validBody)),
      splitTaskRoute(request(validBody)),
    ]);
    expect(
      [first.status, second.status].sort((left, right) => left - right),
    ).toEqual([201, 409]);

    const children = database.sqlite
      .prepare(
        'SELECT title FROM tasks WHERE parent_task_id = ? ORDER BY title',
      )
      .all('task-00000001') as Array<{ title: string }>;
    expect(children.map((child) => child.title)).toEqual([
      '接入 GitHub 登录',
      '设计空状态',
    ]);
  });

  it('rejects malformed, unauthenticated, cross-origin, stale, and nested splits', async () => {
    expect(
      (await splitTaskRoute(request(validBody, { cookie: false }))).status,
    ).toBe(403);
    expect(
      (
        await splitTaskRoute(
          request(validBody, { requestOrigin: 'https://evil.example' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await splitTaskRoute(
          request({
            ...validBody,
            titles: Array.from({ length: 21 }, () => 'x'),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await splitTaskRoute(request({ ...validBody, titles: [' ', 'valid'] })))
        .status,
    ).toBe(400);
    expect(
      (
        await splitTaskRoute(
          request({ ...validBody, titles: ['x'.repeat(161)] }),
        )
      ).status,
    ).toBe(400);

    const first = await splitTaskRoute(request(validBody));
    expect(first.status).toBe(201);
    expect((await splitTaskRoute(request(validBody))).status).toBe(409);
    const childId = ((await first.json()) as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;
    const childRevision = Number(
      (
        database.sqlite
          .prepare('SELECT updated_at FROM tasks WHERE id = ?')
          .get(childId) as { updated_at: number }
      ).updated_at,
    );
    expect(
      (
        await splitTaskRoute(
          request({
            ...validBody,
            parentTaskId: childId,
            parentUpdatedAt: childRevision,
            titles: ['grandchild'],
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      Number(
        (
          database.sqlite
            .prepare(
              "SELECT COUNT(*) AS count FROM tasks WHERE title = 'grandchild'",
            )
            .get() as { count: number }
        ).count,
      ),
    ).toBe(0);
  });

  it('rejects foreign-project and archived parents', async () => {
    const now = 1_700_000_000_100;
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
      (await splitTaskRoute(request({ ...validBody, projectId: 'project-2' })))
        .status,
    ).toBe(404);

    await setTaskArchived(
      'project-1',
      'task-00000001',
      true,
      validBody.parentUpdatedAt,
    );
    expect((await splitTaskRoute(request(validBody))).status).toBe(404);
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM tasks WHERE parent_task_id = ?')
        .get('task-00000001'),
    ).toEqual({ count: 0 });
  });

  it('derives progress from current active children without stored counters', () => {
    const tasks = [
      { id: 'parent', status: 'building' as const },
      {
        id: 'child-a',
        status: 'shipped' as const,
        parent: { id: 'parent' },
      },
      {
        id: 'child-b',
        status: 'ideas' as const,
        parent: { id: 'parent' },
      },
      {
        id: 'other-child',
        status: 'shipped' as const,
        parent: { id: 'other' },
      },
    ];
    expect(subtaskProgress(tasks, 'parent')).toEqual({
      done: 1,
      total: 2,
      percent: 50,
    });
    expect(subtaskProgress([tasks[0]!], 'parent')).toEqual({
      done: 0,
      total: 0,
      percent: 0,
    });
  });

  it('treats the untouched starter description as empty for editor and card display', () => {
    expect(clearStarterTaskNote(STARTER_TASK_NOTE)).toBe('');
    expect(clearStarterTaskNote('用户写下的真实描述')).toBe(
      '用户写下的真实描述',
    );
  });

  it('summarizes acceptance progress without treating an empty list as done', () => {
    expect(acceptanceProgress(undefined)).toEqual({
      done: 0,
      total: 0,
      complete: false,
    });
    expect(
      acceptanceProgress([{ completed: true }, { completed: false }]),
    ).toEqual({ done: 1, total: 2, complete: false });
    expect(acceptanceProgress([{ completed: true }])).toEqual({
      done: 1,
      total: 1,
      complete: true,
    });
  });

  it('places same-column children directly below their parent', () => {
    const tasks = [
      {
        id: 'child-b',
        status: 'ideas' as const,
        position: 0,
        parent: { id: 'parent' },
      },
      { id: 'standalone', status: 'ideas' as const, position: 1 },
      { id: 'parent', status: 'ideas' as const, position: 2 },
      {
        id: 'child-a',
        status: 'ideas' as const,
        position: 3,
        parent: { id: 'parent' },
      },
      {
        id: 'other-column-child',
        status: 'building' as const,
        position: 0,
        parent: { id: 'parent' },
      },
    ];

    expect(
      groupSameColumnTaskFamilies(tasks, 'ideas').map((task) => task.id),
    ).toEqual(['standalone', 'parent', 'child-b', 'child-a']);
    expect(
      groupSameColumnTaskFamilies(tasks, 'building').map((task) => task.id),
    ).toEqual(['other-column-child']);
  });

  it('classifies standalone, parent, and subtask cards for hierarchy styling', () => {
    expect(taskHierarchyKind({})).toBe('standalone');
    expect(taskHierarchyKind({}, { total: 2 })).toBe('parent');
    expect(taskHierarchyKind({ parent: { id: 'parent' } }, { total: 2 })).toBe(
      'subtask',
    );
  });

  it('routes child lookups through the project-parent index', () => {
    const plan = database.sqlite
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE project_id = ? AND parent_task_id = ?',
      )
      .all('project-1', 'task-00000001') as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join('\n')).toContain(
      'idx_tasks_project_parent',
    );
  });

  it('keeps children active on parent archive and promotes them on parent deletion', async () => {
    const split = await splitTaskRoute(request(validBody));
    expect(split.status).toBe(201);
    const splitPayload = (await split.json()) as {
      parentUpdatedAt: number;
      tasks: Array<{ id: string; updatedAt: number }>;
    };
    const archivedParent = await setTaskArchived(
      'project-1',
      'task-00000001',
      true,
      splitPayload.parentUpdatedAt,
    );
    expect(archivedParent).not.toBeNull();

    const childrenWhileArchived = (await listTasks('project-1')).filter(
      (task) => task.parent?.id === 'task-00000001',
    );
    expect(childrenWhileArchived).toHaveLength(2);
    expect(childrenWhileArchived[0]?.parent?.archived).toBe(true);
    const childRevisions = new Map(
      childrenWhileArchived.map((task) => [task.id, task.updatedAt]),
    );

    await permanentlyDeleteArchivedTask(
      'project-1',
      'task-00000001',
      archivedParent!.updatedAt,
    );
    const promoted = await listTasks('project-1');
    expect(promoted).toHaveLength(2);
    for (const child of promoted) {
      expect(child.parent).toBeUndefined();
      expect(child.updatedAt).toBeGreaterThan(childRevisions.get(child.id)!);
    }
  });

  it('does not affect the parent or siblings when a child is deleted', async () => {
    const split = await splitTaskRoute(request(validBody));
    const children = (
      (await split.json()) as {
        tasks: Array<{ id: string; updatedAt: number }>;
      }
    ).tasks;
    const archivedChild = await setTaskArchived(
      'project-1',
      children[0]!.id,
      true,
      children[0]!.updatedAt,
    );
    await permanentlyDeleteArchivedTask(
      'project-1',
      children[0]!.id,
      archivedChild!.updatedAt,
    );

    const remaining = await listTasks('project-1');
    expect(remaining.map((task) => task.id).sort()).toEqual(
      ['task-00000001', children[1]!.id].sort(),
    );
    expect(
      remaining.find((task) => task.id === children[1]!.id)?.parent?.id,
    ).toBe('task-00000001');
  });

  it('returns authoritative promoted child revisions after deleting a parent', async () => {
    const split = await splitTaskRoute(request(validBody));
    const payload = (await split.json()) as {
      parentUpdatedAt: number;
      tasks: Array<{ id: string; updatedAt: number }>;
    };
    const archivedParent = await setTaskArchived(
      'project-1',
      'task-00000001',
      true,
      payload.parentUpdatedAt,
    );
    Object.assign(env, { ATTACHMENTS: { delete: async () => undefined } });
    const response = await deleteTaskRoute(
      new Request(`${origin}/api/tasks`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          id: 'task-00000001',
          updatedAt: archivedParent!.updatedAt,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const deleted = (await response.json()) as {
      promotedTasks: Array<{
        id: string;
        updatedAt: number;
        parent?: unknown;
      }>;
    };
    expect(deleted.promotedTasks).toHaveLength(2);
    for (const promoted of deleted.promotedTasks) {
      const previous = payload.tasks.find((task) => task.id === promoted.id)!;
      expect(promoted.parent).toBeUndefined();
      expect(promoted.updatedAt).toBeGreaterThan(previous.updatedAt);
    }
  });

  it('lets an Agent split a task idempotently through the public task API', async () => {
    const token = seedAgentToken(
      database,
      '11111111-1111-4111-8111-111111111111',
      's'.repeat(48),
      'Codex',
    );
    const agentRequest = () =>
      new Request(`${origin}/api/v1/tasks`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'split-task-00000001',
        },
        body: JSON.stringify({
          id: 'task-00000001',
          action: 'split',
          titles: ['Agent child one', 'Agent child two'],
        }),
      });

    const first = await agentTaskRoute(agentRequest());
    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as {
      data: { tasks: Array<{ id: string; parent: { id: string } }> };
    };
    expect(firstPayload.data.tasks).toHaveLength(2);
    expect(firstPayload.data.tasks[0]?.parent.id).toBe('task-00000001');

    const replay = await agentTaskRoute(agentRequest());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstPayload);
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM tasks WHERE parent_task_id = ?')
        .get('task-00000001'),
    ).toEqual({ count: 2 });
  });

  it('prevents an Agent from splitting work claimed by another token', async () => {
    const firstTokenId = '11111111-1111-4111-8111-111111111111';
    const secondTokenId = '22222222-2222-4222-8222-222222222222';
    const token = seedAgentToken(
      database,
      firstTokenId,
      's'.repeat(48),
      'Codex One',
    );
    seedAgentToken(database, secondTokenId, 't'.repeat(48), 'Codex Two');
    database.sqlite
      .prepare(
        `INSERT INTO task_agent_claims
         (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at)
         VALUES ('task-00000001', 'project-1', ?, 'Codex Two', ?, ?, ?)`,
      )
      .run(secondTokenId, Date.now() + 60_000, Date.now(), Date.now());
    const response = await agentTaskRoute(
      new Request(`${origin}/api/v1/tasks`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'blocked-split-task',
        },
        body: JSON.stringify({
          id: 'task-00000001',
          action: 'split',
          titles: ['Must not exist'],
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'claimed_by_another_agent' },
    });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM tasks WHERE parent_task_id = ?')
        .get('task-00000001'),
    ).toEqual({ count: 0 });
  });
});
