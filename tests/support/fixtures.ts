import { createHash } from 'node:crypto';

import { env } from 'cloudflare:workers';

import type { TestD1Database } from './d1';

export const origin = 'https://kanby.test';
export const sessionSecret = 'test-session-secret-with-at-least-32-bytes';

export function configureEnvironment(database: TestD1Database) {
  Object.assign(env, {
    DB: database,
    PUBLIC_APP_ORIGIN: origin,
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    SESSION_SECRET: sessionSecret,
    GITHUB_APP_ID: '1234',
    GITHUB_APP_SLUG: 'kanby-test',
    GITHUB_APP_PRIVATE_KEY: 'test-private-key',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  });
}

export function seedProject(database: TestD1Database) {
  const now = 1_700_000_000_000;
  database.sqlite
    .prepare(
      'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('user-1', 'alice', 'Alice', null, now, now);
  database.sqlite
    .prepare(
      'INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('project-1', 'Project One', 'project-one', 'user-1', now, now);
  database.sqlite
    .prepare(
      'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run('project-1', 'user-1', 'owner', now);
}

export function seedAgentToken(
  database: TestD1Database,
  tokenId: string,
  secret: string,
  name: string,
) {
  const token = `kby_${tokenId}_${secret}`;
  database.sqlite
    .prepare(
      `INSERT INTO agent_tokens
      (id, project_id, user_id, name, token_hash, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at)
     VALUES (?, 'project-1', 'user-1', ?, ?, ?, 'task:read,task:write', NULL, NULL, NULL, ?)`,
    )
    .run(
      tokenId,
      name,
      createHash('sha256').update(token).digest('hex'),
      token.slice(0, 13),
      1_700_000_000_000,
    );
  return token;
}

export function seedTask(
  database: TestD1Database,
  overrides: { id?: string; title?: string; updatedAt?: number } = {},
) {
  const id = overrides.id ?? 'task-00000001';
  const updatedAt = overrides.updatedAt ?? 1_700_000_000_000;
  database.sqlite
    .prepare(
      `INSERT INTO tasks
      (id, project_id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
     VALUES (?, 'project-1', ?, '', '产品', 'user-1', 'alice', 'Alice', NULL, NULL, 'ideas', 0, ?, ?, 'user-1')`,
    )
    .run(id, overrides.title ?? 'Original', updatedAt, updatedAt);
  return { id, updatedAt };
}

export function agentRequest(token: string, body: unknown, key: string) {
  return new Request(`${origin}/api/v1/tasks`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
}

/** Links an existing repository row to a project through its installation. */
export function linkGitHubRepository(
  database: TestD1Database,
  repositoryId: string,
  projectId = 'project-1',
) {
  const repository = database.sqlite
    .prepare('SELECT installation_id FROM github_repositories WHERE id = ?')
    .get(repositoryId) as { installation_id: string } | undefined;
  const installationId =
    repository?.installation_id ?? `installation-${repositoryId}`;
  if (!repository)
    database.sqlite
      .prepare(
        `INSERT INTO github_repositories
         (id, installation_id, name, full_name, html_url, default_branch, private, active, updated_at)
         VALUES (?, ?, ?, ?, ?, 'main', 1, 1, 1)`,
      )
      .run(
        repositoryId,
        installationId,
        repositoryId,
        `test/${repositoryId}`,
        `https://github.com/test/${repositoryId}`,
      );
  database.sqlite
    .prepare(
      `INSERT INTO github_project_installations (project_id, installation_id, connected_by, created_at)
       VALUES (?, ?, 'user-1', 1)
       ON CONFLICT(project_id) DO UPDATE SET installation_id = excluded.installation_id`,
    )
    .run(projectId, installationId);
  database.sqlite
    .prepare(
      'INSERT OR IGNORE INTO github_project_repositories (project_id, repository_id, created_at) VALUES (?, ?, 1)',
    )
    .run(projectId, repositoryId);
}
