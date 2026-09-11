import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskAttachment } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  seedProject,
  seedTask,
} from './support/fixtures';

describe('attachment limits', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedTask(database, { id: 'attachment-task' });
  });

  afterEach(() => database.close());

  it('atomically stores no more than ten attachments for a task', async () => {
    const results = [];
    for (let index = 0; index < 11; index += 1) {
      results.push(
        await createTaskAttachment({
          projectId: 'project-1',
          taskId: 'attachment-task',
          objectKey: `object-${index}`,
          fileName: `file-${index}.txt`,
          contentType: 'text/plain',
          size: 1,
          createdBy: 'user-1',
        }),
      );
    }
    const count = database.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = 'attachment-task'",
      )
      .get() as { count: number };

    expect(Number(count.count)).toBe(10);
    expect(results.filter(Boolean)).toHaveLength(10);
  });
});
