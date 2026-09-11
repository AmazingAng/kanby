import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DELETE as deleteToken,
  GET as listTokens,
  POST as createToken,
} from '@/app/api/agent-tokens/route';
import { GET as listAgentProjects } from '@/app/api/v1/projects/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedProject,
  sessionSecret,
} from './support/fixtures';

type SessionName = 'owner' | 'member' | 'outsider';

describe('member-owned Agent Tokens', () => {
  let database: TestD1Database;
  let sessions: Record<SessionName, string>;

  beforeEach(async () => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('user-2', 'bob', 'Bob', null, 1, 1);
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('user-3', 'mallory', 'Mallory', null, 1, 1);
    database.sqlite
      .prepare(
        'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run('project-1', 'user-2', 'member', 1);
    sessions = {
      owner: await createSessionToken(
        { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
        sessionSecret,
      ),
      member: await createSessionToken(
        { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
        sessionSecret,
      ),
      outsider: await createSessionToken(
        { id: 'user-3', login: 'mallory', name: 'Mallory', avatarUrl: null },
        sessionSecret,
      ),
    };
  });

  afterEach(() => database.close());

  function request(
    method: 'GET' | 'POST' | 'DELETE',
    sessionName: SessionName,
    body?: Record<string, unknown>,
  ) {
    return new Request(`${origin}/api/agent-tokens?projectId=project-1`, {
      method,
      headers: {
        Cookie: `${SESSION_COOKIE}=${sessions[sessionName]}`,
        Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body
        ? { body: JSON.stringify({ projectId: 'project-1', ...body }) }
        : {}),
    });
  }

  function seedToken(input: {
    id: string;
    userId: string;
    name: string;
    secret?: string;
    expiresAt?: number | null;
    revokedAt?: number | null;
  }) {
    const secret = input.secret ?? 's'.repeat(48);
    const token = `kby_${input.id}_${secret}`;
    database.sqlite
      .prepare(
        `INSERT INTO agent_tokens
         (id, project_id, user_id, name, token_hash, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at)
         VALUES (?, 'project-1', ?, ?, ?, ?, 'task:read,task:write', ?, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.name,
        createHash('sha256').update(token).digest('hex'),
        token.slice(0, 13),
        input.expiresAt ?? null,
        input.revokedAt ?? null,
        Date.now(),
      );
    return token;
  }

  it('lets a member create a server-attributed token without owner spoofing', async () => {
    const response = await createToken(
      request('POST', 'member', {
        name: 'codex',
        userLogin: 'mallory',
        expiresInDays: 90,
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      token: string;
      record: {
        id: string;
        name: string;
        label: string;
        user: { id: string; login: string; name: string };
      };
    };
    expect(payload.token).toMatch(/^kby_[0-9a-f-]{36}_[A-Za-z0-9_-]{40,}$/);
    expect(payload.record).toMatchObject({
      name: 'codex',
      label: 'bob_codex',
      user: { id: 'user-2', login: 'bob', name: 'Bob' },
    });
    const stored = database.sqlite
      .prepare(
        'SELECT user_id, name, token_hash FROM agent_tokens WHERE id = ?',
      )
      .get(payload.record.id) as {
      user_id: string;
      name: string;
      token_hash: string;
    };
    expect(stored).toMatchObject({ user_id: 'user-2', name: 'codex' });
    expect(stored.token_hash).not.toBe(payload.token);
  });

  it('shows members only their tokens while owners can administer the project', async () => {
    const ownerToken = seedToken({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      name: 'deploy',
      secret: 'o'.repeat(48),
    });
    const memberToken = seedToken({
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'user-2',
      name: 'codex',
      secret: 'm'.repeat(48),
    });

    const memberResponse = await listTokens(request('GET', 'member'));
    expect(memberResponse.status).toBe(200);
    const memberPayload = (await memberResponse.json()) as {
      tokens: Array<{
        id: string;
        label: string;
        canRevoke: boolean;
        user: { login: string };
      }>;
    };
    expect(memberPayload.tokens).toMatchObject([
      {
        id: '22222222-2222-4222-8222-222222222222',
        label: 'bob_codex',
        canRevoke: true,
        user: { login: 'bob' },
      },
    ]);
    expect(JSON.stringify(memberPayload)).not.toContain(ownerToken);
    expect(JSON.stringify(memberPayload)).not.toContain(memberToken);

    const ownerResponse = await listTokens(request('GET', 'owner'));
    const ownerPayload = (await ownerResponse.json()) as {
      tokens: Array<{ label: string; canRevoke: boolean }>;
    };
    expect(ownerPayload.tokens.map((token) => token.label).sort()).toEqual([
      'alice_deploy',
      'bob_codex',
    ]);
    expect(ownerPayload.tokens.every((token) => token.canRevoke)).toBe(true);
  });

  it('enforces personal revocation while retaining owner administration', async () => {
    const ownerTokenId = '11111111-1111-4111-8111-111111111111';
    const memberTokenId = '22222222-2222-4222-8222-222222222222';
    const secondMemberTokenId = '33333333-3333-4333-8333-333333333333';
    seedToken({ id: ownerTokenId, userId: 'user-1', name: 'owner' });
    seedToken({ id: memberTokenId, userId: 'user-2', name: 'member' });
    seedToken({
      id: secondMemberTokenId,
      userId: 'user-2',
      name: 'member-two',
    });

    const denied = await deleteToken(
      request('DELETE', 'member', { tokenId: ownerTokenId }),
    );
    expect(denied.status).toBe(404);
    expect(
      database.sqlite
        .prepare('SELECT revoked_at FROM agent_tokens WHERE id = ?')
        .get(ownerTokenId),
    ).toEqual({ revoked_at: null });

    expect(
      (
        await deleteToken(
          request('DELETE', 'member', { tokenId: memberTokenId }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await deleteToken(
          request('DELETE', 'owner', { tokenId: secondMemberTokenId }),
        )
      ).status,
    ).toBe(200);
  });

  it('rejects every token-management operation from a non-member', async () => {
    expect((await listTokens(request('GET', 'outsider'))).status).toBe(403);
    expect(
      (
        await createToken(
          request('POST', 'outsider', {
            name: 'codex',
            expiresInDays: 30,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await deleteToken(
          request('DELETE', 'outsider', {
            tokenId: '11111111-1111-4111-8111-111111111111',
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('invalidates a member token immediately when membership is removed', async () => {
    const token = seedToken({
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'user-2',
      name: 'codex',
      secret: 'z'.repeat(48),
    });
    const agentRequest = () =>
      new Request(`${origin}/api/v1/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    expect((await listAgentProjects(agentRequest())).status).toBe(200);
    database.sqlite
      .prepare(
        "DELETE FROM project_members WHERE project_id = 'project-1' AND user_id = 'user-2'",
      )
      .run();
    expect((await listAgentProjects(agentRequest())).status).toBe(401);
  });

  it('atomically limits one member to ten active tokens', async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createToken(
          request('POST', 'member', {
            name: `agent-${index}`,
            expiresInDays: 90,
          }),
        ),
      ),
    );
    expect(
      responses
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 201, 201, 201, 201, 201, 201, 201, 201, 201, 409, 409]);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_tokens WHERE project_id = 'project-1' AND user_id = 'user-2' AND revoked_at IS NULL",
        )
        .get(),
    ).toEqual({ count: 10 });
  });

  it('rejects hostile names while accepting a bounded Unicode name', async () => {
    const invalid = await Promise.all([
      createToken(request('POST', 'member', { name: '', expiresInDays: 90 })),
      createToken(
        request('POST', 'member', {
          name: 'a'.repeat(49),
          expiresInDays: 90,
        }),
      ),
      createToken(
        request('POST', 'member', {
          name: 'bad\u0001name',
          expiresInDays: 90,
        }),
      ),
    ]);
    expect(invalid.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_tokens WHERE project_id = 'project-1'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const valid = await createToken(
      request('POST', 'member', { name: '编程助手', expiresInDays: 90 }),
    );
    expect(valid.status).toBe(201);
    expect(await valid.json()).toMatchObject({
      record: { name: '编程助手', label: 'bob_编程助手' },
    });
  });
});
