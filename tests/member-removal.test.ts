import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as listTasksRoute } from '@/app/api/v1/tasks/route';
import { removeProjectMember } from '@/lib/db';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
} from './support/fixtures';

const tokenId = '33333333-3333-4333-8333-333333333333';

describe('member removal', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    database.sqlite
      .prepare(
        "INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES ('user-2', 'bob', 'Bob', NULL, 1, 1)",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('project-1', 'user-2', 'member', 1)",
      )
      .run();
  });

  afterEach(() => database.close());

  it('revokes the member tokens so re-adding them does not revive old tokens', async () => {
    const token = seedAgentToken(
      database,
      tokenId,
      'b'.repeat(48),
      'bob-agent',
    );
    database.sqlite
      .prepare("UPDATE agent_tokens SET user_id = 'user-2' WHERE id = ?")
      .run(tokenId);
    database.sqlite
      .prepare(
        "INSERT INTO task_agent_claims (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at) VALUES ('t', 'project-1', ?, 'bob-agent', ?, 1, 1)",
      )
      .run(tokenId, Date.now() + 60_000);
    const list = () =>
      listTasksRoute(
        new Request(`${origin}/api/v1/tasks`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    expect((await list()).status).toBe(200);

    await removeProjectMember('project-1', 'user-2');
    database.sqlite
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES ('project-1', 'user-2', 'member', 2)",
      )
      .run();

    expect((await list()).status).toBe(401);
    expect(
      database.sqlite
        .prepare('SELECT revoked_at IS NOT NULL AS revoked FROM agent_tokens')
        .get(),
    ).toEqual({ revoked: 1 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS n FROM task_agent_claims')
        .get(),
    ).toEqual({ n: 0 });
  });

  it('releases claims held under a token the member revoked earlier', async () => {
    seedAgentToken(database, tokenId, 'b'.repeat(48), 'bob-agent');
    database.sqlite
      .prepare(
        "UPDATE agent_tokens SET user_id = 'user-2', revoked_at = 1 WHERE id = ?",
      )
      .run(tokenId);
    database.sqlite
      .prepare(
        "INSERT INTO task_agent_claims (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at) VALUES ('t', 'project-1', ?, 'bob-agent', ?, 1, 1)",
      )
      .run(tokenId, Date.now() + 60_000);
    await removeProjectMember('project-1', 'user-2');
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS n FROM task_agent_claims')
        .get(),
    ).toEqual({ n: 0 });
  });

  it('never revokes the owner tokens', async () => {
    seedAgentToken(database, tokenId, 'b'.repeat(48), 'alice-agent');
    await removeProjectMember('project-1', 'user-1');
    expect(
      database.sqlite.prepare('SELECT revoked_at FROM agent_tokens').get(),
    ).toEqual({ revoked_at: null });
  });
});
