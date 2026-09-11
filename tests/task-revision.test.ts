import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUT } from '@/app/api/tasks/route';
import { createSessionToken } from '@/lib/auth';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

describe('conflict-safe task saves', () => {
  let database: TestD1Database;
  let cookie: string;

  beforeEach(async () => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedTask(database);
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    cookie = `tinyship_session=${encodeURIComponent(session)}`;
  });

  afterEach(() => database.close());

  function updateRequest(title: string, updatedAt: number) {
    return new Request(`${origin}/api/tasks`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: 'project-1',
        id: 'task-00000001',
        title,
        note: '',
        tag: '产品',
        ownerId: 'user-1',
        due: '',
        status: 'ideas',
        updatedAt,
      }),
    });
  }

  it('rejects a stale full-card save without overwriting the newer row', async () => {
    const originalRevision = 1_700_000_000_000;
    const first = await PUT(updateRequest('First writer', originalRevision));
    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as {
      task: { updatedAt: number };
    };
    expect(firstPayload.task.updatedAt).toBeGreaterThan(originalRevision);

    const stale = await PUT(updateRequest('Stale writer', originalRevision));
    expect(stale.status).toBe(409);
    const stored = database.sqlite
      .prepare('SELECT title FROM tasks WHERE id = ?')
      .get('task-00000001') as { title: string };
    expect(stored.title).toBe('First writer');
  });
});
