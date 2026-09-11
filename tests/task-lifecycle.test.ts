import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DELETE as deleteTaskRoute } from '@/app/api/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  createTaskAttachment,
  listTasks,
  permanentlyDeleteArchivedTask,
  setTaskArchived,
  TaskRevisionConflictError,
} from '@/lib/db';
import { appendTaskActivity } from '@/lib/task-activity';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

describe('task archive and permanent deletion', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => database.close());

  it('hides archived tasks, rejects stale lifecycle writes, and restores them', async () => {
    const task = seedTask(database);
    const archived = await setTaskArchived(
      'project-1',
      task.id,
      true,
      task.updatedAt,
    );

    expect((await listTasks('project-1')).map((item) => item.id)).not.toContain(
      task.id,
    );
    expect((await listTasks('project-1', true)).map((item) => item.id)).toEqual(
      [task.id],
    );
    await expect(
      setTaskArchived('project-1', task.id, false, task.updatedAt),
    ).rejects.toBeInstanceOf(TaskRevisionConflictError);

    const restored = await setTaskArchived(
      'project-1',
      task.id,
      false,
      archived!.updatedAt,
    );
    expect(restored?.archivedAt).toBeUndefined();
    expect((await listTasks('project-1')).map((item) => item.id)).toContain(
      task.id,
    );
  });

  it('permanently deletes only archived tasks and returns R2 cleanup keys', async () => {
    const task = seedTask(database);
    expect(
      await permanentlyDeleteArchivedTask('project-1', task.id, task.updatedAt),
    ).toBeNull();
    const attachment = await createTaskAttachment({
      projectId: 'project-1',
      taskId: task.id,
      objectKey: 'project-1/task-1/object-1',
      fileName: 'proof.png',
      contentType: 'image/png',
      size: 100,
      createdBy: 'user-1',
    });
    const tokenId = '11111111-1111-4111-8111-111111111111';
    seedAgentToken(database, tokenId, 's'.repeat(48), 'Agent One');
    database.sqlite
      .prepare(
        `INSERT INTO task_agent_claims
         (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at)
         VALUES (?, 'project-1', ?, 'Agent One', ?, ?, ?)`,
      )
      .run(task.id, tokenId, Date.now() + 60_000, Date.now(), Date.now());
    database.sqlite
      .prepare(
        `INSERT INTO task_agent_updates
         (id, project_id, task_id, token_id, kind, message, metadata, created_at)
         VALUES ('update-1', 'project-1', ?, ?, 'progress', 'working', NULL, ?)`,
      )
      .run(task.id, tokenId, Date.now());
    await appendTaskActivity({
      projectId: 'project-1',
      taskId: task.id,
      source: 'user',
      kind: 'comment.created',
      actorId: 'user-1',
      actorName: 'Alice',
      body: 'Delete this with the task',
      summary: 'Alice commented',
    });
    database.sqlite
      .prepare(
        `INSERT INTO github_issue_imports
         (id, project_id, repository_id, item_number, task_id, created_by, created_at)
         VALUES ('import-1', 'project-1', 'repository-1', 12, ?, 'user-1', ?)`,
      )
      .run(task.id, Date.now());
    const archived = await setTaskArchived(
      'project-1',
      task.id,
      true,
      task.updatedAt,
    );
    await expect(
      permanentlyDeleteArchivedTask(
        'project-1',
        task.id,
        archived!.updatedAt - 1,
      ),
    ).rejects.toBeInstanceOf(TaskRevisionConflictError);

    const keys = await permanentlyDeleteArchivedTask(
      'project-1',
      task.id,
      archived!.updatedAt,
    );

    expect(keys).toEqual(['project-1/task-1/object-1']);
    expect(attachment).not.toBeNull();
    for (const table of [
      'tasks',
      'task_attachments',
      'task_agent_claims',
      'task_agent_updates',
      'task_events',
      'github_issue_imports',
    ]) {
      const row = database.sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'tasks' ? 'id' : 'task_id'} = ?`,
        )
        .get(task.id) as { count: number };
      expect(Number(row.count), table).toBe(0);
    }
  });

  it('permanently deletes through the owner route and cleans up R2', async () => {
    const task = seedTask(database);
    await createTaskAttachment({
      projectId: 'project-1',
      taskId: task.id,
      objectKey: 'project-1/task-1/route-object',
      fileName: 'route-proof.png',
      contentType: 'image/png',
      size: 100,
      createdBy: 'user-1',
    });
    const archived = await setTaskArchived(
      'project-1',
      task.id,
      true,
      task.updatedAt,
    );
    const deletedKeys: string[] = [];
    Object.assign(env, {
      ATTACHMENTS: {
        delete: async (objectKey: string) => {
          deletedKeys.push(objectKey);
        },
      },
    });
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
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
          id: task.id,
          updatedAt: archived!.updatedAt,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cleanupPending: false });
    expect(deletedKeys).toEqual(['project-1/task-1/route-object']);
    expect(await listTasks('project-1', true)).toHaveLength(0);
  });

  it('rejects permanent deletion by a non-owner', async () => {
    const task = seedTask(database);
    const archived = await setTaskArchived(
      'project-1',
      task.id,
      true,
      task.updatedAt,
    );
    const now = Date.now();
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .run('user-2', 'bob', 'Bob', now, now);
    database.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('project-1', 'user-2', 'member', ?)",
      )
      .run(now);
    Object.assign(env, {
      ATTACHMENTS: { delete: async () => undefined },
    });
    const session = await createSessionToken(
      { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
      sessionSecret,
    );
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
          id: task.id,
          updatedAt: archived!.updatedAt,
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await listTasks('project-1', true)).toHaveLength(1);
  });
});
