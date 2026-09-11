import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GET as getTaskEvents,
  POST as postTaskEvent,
} from '@/app/api/task-events/route';
import {
  PATCH as patchBrowserTask,
  POST as postBrowserTask,
  PUT as putBrowserTask,
} from '@/app/api/tasks/route';
import { PATCH as patchAgentTask } from '@/app/api/v1/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  appendTaskActivity,
  listProjectAgentStates,
  listTaskActivity,
  userActivityActor,
} from '@/lib/task-activity';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  agentRequest,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
  sessionSecret,
} from './support/fixtures';

describe('unified task activity', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => {
    vi.useRealTimers();
    database.close();
  });

  it('derives the browser actor snapshot from the authenticated user', () => {
    expect(
      userActivityActor({
        id: 'user-1',
        login: 'alice',
        name: 'Alice',
        avatarUrl: 'https://avatars.test/alice.png',
      }),
    ).toEqual({
      actorId: 'user-1',
      actorName: 'Alice',
      actorLogin: 'alice',
      actorAvatarUrl: 'https://avatars.test/alice.png',
    });
  });

  it('coalesces a repeated edit session and keeps the newest content', async () => {
    const task = seedTask(database, { id: 'task-activity-edit' });
    const base = {
      projectId: 'project-1',
      taskId: task.id,
      source: 'user' as const,
      kind: 'task.updated',
      actorName: 'Alice',
      actorId: 'user-1',
      actorLogin: 'alice',
      summary: 'Alice 修改了任务',
      dedupeKey: `edit:${task.id}:user-1:session-1`,
    };

    await appendTaskActivity({
      ...base,
      metadata: { fields: ['title'] },
      createdAt: 100,
    });
    await appendTaskActivity({
      ...base,
      metadata: { fields: ['title', 'due'] },
      createdAt: 101,
    });

    const page = await listTaskActivity({
      projectId: 'project-1',
      taskId: task.id,
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      metadata: { fields: ['title', 'due'] },
      createdAt: 101,
    });
  });

  it('paginates equal timestamps without gaps or duplicates', async () => {
    const task = seedTask(database, { id: 'task-activity-pages' });
    for (let index = 0; index < 25; index += 1) {
      await appendTaskActivity({
        id: `event-${String(index).padStart(2, '0')}`,
        projectId: 'project-1',
        taskId: task.id,
        source: 'system',
        kind: 'test.event',
        actorName: 'Kanby',
        summary: `Event ${index}`,
        createdAt: 200,
      });
    }

    const first = await listTaskActivity({
      projectId: 'project-1',
      taskId: task.id,
      limit: 20,
    });
    const second = await listTaskActivity({
      projectId: 'project-1',
      taskId: task.id,
      limit: 20,
      cursor: first.nextCursor,
    });
    const ids = [...first.events, ...second.events].map((event) => event.id);

    expect(first.events).toHaveLength(20);
    expect(second.events).toHaveLength(5);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it('rejects a malformed cursor and tolerates legacy malformed metadata', async () => {
    const task = seedTask(database, { id: 'task-activity-hostile' });
    database.sqlite
      .prepare(
        `INSERT INTO task_events
         (id, project_id, task_id, source, kind, actor_id, actor_name, actor_login, actor_avatar_url, summary, body, metadata, dedupe_key, created_at)
         VALUES ('event-hostile', 'project-1', ?, 'system', 'test.event', NULL, 'Kanby', NULL, NULL, 'Legacy event', NULL, '{bad-json', NULL, 300)`,
      )
      .run(task.id);

    await expect(
      listTaskActivity({
        projectId: 'project-1',
        taskId: task.id,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toThrow('Invalid activity cursor');
    expect(
      (
        await listTaskActivity({
          projectId: 'project-1',
          taskId: task.id,
        })
      ).events[0].metadata,
    ).toBeNull();
  });

  it('returns only live claims with their latest progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const live = seedTask(database, { id: 'task-agent-live' });
    const expired = seedTask(database, { id: 'task-agent-expired' });
    const tokenId = '33333333-3333-4333-8333-333333333333';
    seedAgentToken(database, tokenId, 'z'.repeat(48), 'Alice / Codex');
    const insertClaim = database.sqlite.prepare(
      `INSERT INTO task_agent_claims
       (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at)
       VALUES (?, 'project-1', ?, 'Alice / Codex', ?, ?, ?)`,
    );
    insertClaim.run(
      live.id,
      tokenId,
      Date.now() + 60_000,
      Date.now() - 5_000,
      Date.now() - 1_000,
    );
    insertClaim.run(
      expired.id,
      tokenId,
      Date.now() - 1,
      Date.now() - 60_000,
      Date.now() - 30_000,
    );
    await appendTaskActivity({
      projectId: 'project-1',
      taskId: live.id,
      source: 'agent',
      kind: 'agent.progress',
      actorId: tokenId,
      actorName: 'Alice / Codex',
      summary: 'Agent 汇报进度',
      body: '正在运行回归测试',
      createdAt: Date.now() - 500,
    });

    expect(await listProjectAgentStates('project-1')).toEqual([
      {
        taskId: live.id,
        agentName: 'Alice / Codex',
        leaseExpiresAt: Date.now() + 60_000,
        lastHeartbeatAt: Date.now() - 1_000,
        latestProgress: '正在运行回归测试',
        latestProgressAt: Date.now() - 500,
      },
    ]);
  });

  it('returns null progress for a live claim that has not reported progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const task = seedTask(database, { id: 'task-agent-no-progress' });
    const tokenId = '55555555-5555-4555-8555-555555555555';
    seedAgentToken(database, tokenId, 'b'.repeat(48), 'Quiet Agent');
    await appendTaskActivity({
      projectId: 'project-1',
      taskId: task.id,
      source: 'agent',
      kind: 'agent.progress',
      actorId: tokenId,
      actorName: 'Quiet Agent',
      summary: '旧一轮 Agent 汇报了进度',
      body: '这是上一次领取留下的进度',
      createdAt: Date.now() - 10_000,
    });
    database.sqlite
      .prepare(
        `INSERT INTO task_agent_claims
         (task_id, project_id, token_id, agent_name, lease_expires_at, created_at, updated_at)
         VALUES (?, 'project-1', ?, 'Quiet Agent', ?, ?, ?)`,
      )
      .run(
        task.id,
        tokenId,
        Date.now() + 60_000,
        Date.now() - 1_000,
        Date.now(),
      );

    expect(await listProjectAgentStates('project-1')).toEqual([
      {
        taskId: task.id,
        agentName: 'Quiet Agent',
        leaseExpiresAt: Date.now() + 60_000,
        lastHeartbeatAt: Date.now(),
        latestProgress: null,
        latestProgressAt: null,
      },
    ]);
  });

  it('creates a bounded comment with the authenticated actor', async () => {
    const task = seedTask(database, { id: 'task-comment' });
    const session = await createSessionToken(
      {
        id: 'user-1',
        login: 'alice',
        name: 'Alice',
        avatarUrl: 'https://avatars.test/alice.png',
      },
      sessionSecret,
    );
    const response = await postTaskEvent(
      new Request(`${origin}/api/task-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify({
          projectId: 'project-1',
          taskId: task.id,
          body: '  请检查移动端  ',
          actorName: 'Forged',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      event: {
        kind: 'comment.created',
        body: '请检查移动端',
        actor: { id: 'user-1', name: 'Alice', login: 'alice' },
      },
    });
  });

  it('rejects invalid comments without writing activity', async () => {
    const task = seedTask(database, { id: 'task-comment-invalid' });
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const request = (body: string, requestOrigin = origin) =>
      new Request(`${origin}/api/task-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: requestOrigin,
        },
        body: JSON.stringify({ projectId: 'project-1', taskId: task.id, body }),
      });

    expect((await postTaskEvent(request('   '))).status).toBe(400);
    expect((await postTaskEvent(request('x'.repeat(2001)))).status).toBe(400);
    expect(
      (await postTaskEvent(request('forged origin', 'https://evil.test')))
        .status,
    ).toBe(403);
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM task_events WHERE task_id = ?')
        .get(task.id),
    ).toEqual({ count: 0 });
  });

  it('prevents non-members from reading another project task activity', async () => {
    const task = seedTask(database, { id: 'task-private-activity' });
    await appendTaskActivity({
      projectId: 'project-1',
      taskId: task.id,
      source: 'system',
      kind: 'task.created',
      actorName: 'Kanby',
      summary: 'Created',
    });
    const now = Date.now();
    database.sqlite
      .prepare(
        'INSERT INTO users (id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .run('user-2', 'bob', 'Bob', now, now);
    const session = await createSessionToken(
      { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
      sessionSecret,
    );
    const response = await getTaskEvents(
      new Request(
        `${origin}/api/task-events?projectId=project-1&taskId=${task.id}`,
        { headers: { Cookie: `${SESSION_COOKIE}=${session}` } },
      ),
    );

    expect(response.status).toBe(403);
  });

  it('records browser create, coalesced edits, cross-column moves, and archive lifecycle', async () => {
    const session = await createSessionToken(
      { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
      sessionSecret,
    );
    const request = (method: string, body: unknown) =>
      new Request(`${origin}/api/tasks`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE}=${session}`,
          Origin: origin,
        },
        body: JSON.stringify(body),
      });

    const createdResponse = await postBrowserTask(
      request('POST', {
        projectId: 'project-1',
        title: 'Activity task',
        status: 'ideas',
      }),
    );
    const created = (await createdResponse.json()) as {
      task: {
        id: string;
        title: string;
        note: string;
        tag: '产品';
        owner: { id: string };
        status: 'ideas';
        updatedAt: number;
      };
    };
    const firstEditResponse = await putBrowserTask(
      request('PUT', {
        projectId: 'project-1',
        ...created.task,
        title: 'Activity task v2',
        ownerId: created.task.owner.id,
        updatedAt: created.task.updatedAt,
        editSessionId: 'editor-session-12345678',
      }),
    );
    const firstEdit = (await firstEditResponse.json()) as {
      task: typeof created.task;
    };
    const secondEditResponse = await putBrowserTask(
      request('PUT', {
        projectId: 'project-1',
        ...firstEdit.task,
        title: 'Activity task v3',
        due: '2026-09-30',
        ownerId: firstEdit.task.owner.id,
        updatedAt: firstEdit.task.updatedAt,
        editSessionId: 'editor-session-12345678',
      }),
    );
    await secondEditResponse.json();

    await patchBrowserTask(
      request('PATCH', {
        projectId: 'project-1',
        movedTaskId: created.task.id,
        items: [{ id: created.task.id, status: 'ideas', position: 0 }],
      }),
    );
    await patchBrowserTask(
      request('PATCH', {
        projectId: 'project-1',
        movedTaskId: created.task.id,
        items: [{ id: created.task.id, status: 'building', position: 0 }],
      }),
    );
    const afterMove = database.sqlite
      .prepare('SELECT updated_at FROM tasks WHERE id = ?')
      .get(created.task.id) as { updated_at: number };
    await patchBrowserTask(
      request('PATCH', {
        projectId: 'project-1',
        id: created.task.id,
        action: 'archive',
        updatedAt: afterMove.updated_at,
      }),
    );

    const events = database.sqlite
      .prepare(
        'SELECT kind, metadata FROM task_events WHERE task_id = ? ORDER BY created_at, id',
      )
      .all(created.task.id) as { kind: string; metadata: string | null }[];
    expect(createdResponse.status).toBe(201);
    expect(firstEditResponse.status).toBe(200);
    expect(secondEditResponse.status).toBe(200);
    expect(events.map((event) => event.kind).sort()).toEqual([
      'task.archived',
      'task.created',
      'task.moved',
      'task.updated',
    ]);
    const edit = events.find((event) => event.kind === 'task.updated');
    expect(JSON.parse(edit?.metadata ?? '{}')).toMatchObject({
      fields: ['title', 'due'],
    });
  });

  it('unifies Agent lifecycle and coalesces repeated heartbeats', async () => {
    const task = seedTask(database, { id: 'task-agent-timeline' });
    const token = seedAgentToken(
      database,
      '44444444-4444-4444-8444-444444444444',
      'a'.repeat(48),
      'Alice / Codex',
    );

    expect(
      (
        await patchAgentTask(
          agentRequest(
            token,
            { id: task.id, action: 'claim', leaseMinutes: 15 },
            'activity-claim-key',
          ),
        )
      ).status,
    ).toBe(200);
    for (const key of ['activity-heartbeat-one', 'activity-heartbeat-two']) {
      expect(
        (
          await patchAgentTask(
            agentRequest(
              token,
              { id: task.id, action: 'heartbeat', leaseMinutes: 15 },
              key,
            ),
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await patchAgentTask(
          agentRequest(
            token,
            {
              id: task.id,
              action: 'progress',
              message: '正在实现任务时间线',
            },
            'activity-progress-key',
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await patchAgentTask(
          agentRequest(
            token,
            { id: task.id, action: 'complete', message: '时间线完成' },
            'activity-complete-key',
          ),
        )
      ).status,
    ).toBe(200);

    const events = database.sqlite
      .prepare(
        "SELECT kind, body FROM task_events WHERE task_id = ? AND source = 'agent' ORDER BY created_at, id",
      )
      .all(task.id) as { kind: string; body: string | null }[];
    expect(events.map((event) => event.kind).sort()).toEqual([
      'agent.claimed',
      'agent.completed',
      'agent.heartbeat',
      'agent.progress',
    ]);
    expect(events.find((event) => event.kind === 'agent.progress')?.body).toBe(
      '正在实现任务时间线',
    );
    expect(await listProjectAgentStates('project-1')).toEqual([]);
  });
});
