import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as activityStore from '@/lib/task-activity';
import { metricsResponse } from '@/lib/team-metrics-response';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as agentMetrics } from '@/app/api/v1/metrics/route';
import { GET as browserMetrics } from '@/app/api/metrics/route';
import { GET as activity } from '@/app/api/v1/activity/route';
import { PATCH as agentTask } from '@/app/api/v1/tasks/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import {
  createTask,
  listTasks,
  updateTask,
  reorderTasks,
  setTaskArchived,
  permanentlyDeleteArchivedTask,
  createAcceptanceCriterion,
  splitTask,
} from '@/lib/db';
import { updateLinkedTasksFromGitHub } from '@/lib/github-db';
import { appendTaskActivity } from '@/lib/task-activity';
import { readTeamMetrics, MetricCapacityError } from '@/lib/team-metrics-store';
import { metricPeriod } from '@/lib/team-metrics';
import { createMigratedDatabase, TestD1Database } from './support/d1';
import {
  seedProject,
  seedAgentToken,
  configureEnvironment,
  origin,
  sessionSecret,
  agentRequest,
} from './support/fixtures';
const user = { id: 'user-1', name: 'Alice', login: 'alice', avatarUrl: null };
const actor = {
  actorId: user.id,
  actorName: user.name,
  actorLogin: user.login,
  actorAvatarUrl: null,
};
const period = () => metricPeriod('2026-09-01', '2026-09-30', 'UTC');
describe('transactional metric collection and read boundaries', () => {
  let db: TestD1Database;
  let token: string;
  beforeEach(() => {
    db = createMigratedDatabase();
    configureEnvironment(db);
    seedProject(db);
    token = seedAgentToken(
      db,
      '33333333-3333-4333-8333-333333333333',
      'm'.repeat(48),
      'Metrics',
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    db.close();
  });
  const rows = () =>
    db.sqlite
      .prepare('SELECT * FROM task_metric_events ORDER BY sequence')
      .all() as {
      state: string;
      task_id: string;
      kind: string;
      occurred_at: number;
    }[];
  it('records only relevant state changes and captures final assignees atomically', async () => {
    const task = await createTask(user, 'project-1', {
      title: 'Private title',
      status: 'building',
      due: '2026-09-10',
    });
    expect(rows()).toHaveLength(1);
    await reorderTasks('project-1', [
      { id: task.id, status: 'building', position: 9 },
    ]);
    expect(rows()).toHaveLength(1);
    const latest = (await listTasks('project-1'))[0]!;
    await updateTask('project-1', {
      ...latest,
      ownerId: user.id,
      expectedUpdatedAt: latest.updatedAt,
      title: 'Another secret',
    });
    expect(rows()).toHaveLength(1);
    db.sqlite
      .prepare("INSERT INTO users VALUES ('user-2','bob','Bob',NULL,1,1)")
      .run();
    db.sqlite
      .prepare(
        "INSERT INTO project_members VALUES ('project-1','user-2','member',1)",
      )
      .run();
    const updated = (await listTasks('project-1'))[0]!;
    await updateTask('project-1', {
      ...updated,
      status: 'shipped',
      ownerId: 'user-2',
      ownerIds: ['user-2', 'user-1'],
      expectedUpdatedAt: updated.updatedAt,
    });
    expect(rows()).toHaveLength(2);
    expect(JSON.parse(rows()[1]!.state)).toMatchObject({
      status: 'shipped',
      owners: ['user-2', 'user-1'],
    });
    expect(JSON.stringify(rows())).not.toContain('secret');
    expect(rows()[1]!.occurred_at).toBeGreaterThan(1_700_000_000_000);
  });
  it('rolls back metric history with a failed write and rejects stale saves', async () => {
    const task = await createTask(user, 'project-1', {
      title: 'One',
      status: 'ideas',
    });
    const count = rows().length;
    await expect(
      db.batch([
        db
          .prepare("UPDATE tasks SET status='shipped' WHERE id=?")
          .bind(task.id),
        db.prepare("UPDATE projects SET updated_at=2 WHERE id='project-1'"),
        db.prepare('INSERT INTO nonexistent VALUES (1)'),
      ]),
    ).rejects.toThrow();
    expect(rows()).toHaveLength(count);
    await expect(
      updateTask('project-1', {
        ...task,
        status: 'shipped',
        ownerId: user.id,
        expectedUpdatedAt: 1,
      }),
    ).rejects.toThrow();
    expect(rows()).toHaveLength(count);
  });
  it('tracks Agent complete, browser moves, GitHub automation and idempotent retries', async () => {
    const task = await createTask(user, 'project-1', {
      title: 'One',
      status: 'building',
    });
    const request = () =>
      agentRequest(
        token,
        { id: task.id, action: 'complete' },
        'metrics-complete',
      );
    expect((await agentTask(request())).status).toBe(200);
    expect((await agentTask(request())).status).toBe(200);
    expect(rows().map((r) => JSON.parse(r.state).status)).toEqual([
      'building',
      'shipped',
    ]);
    await reorderTasks(
      'project-1',
      [{ id: task.id, status: 'building', position: 0 }],
      { movedTaskId: task.id, actor },
    );
    db.sqlite
      .prepare(
        "INSERT INTO github_task_links (task_id,project_id,repository_id,kind,item_number,url,title,state,updated_at) VALUES (?,'project-1','repo','pull_request',1,'https://github.com/a/b/pull/1','PR','open',1)",
      )
      .run(task.id);
    await updateLinkedTasksFromGitHub({
      repositoryId: 'repo',
      kind: 'pull_request',
      number: 1,
      title: 'PR',
      state: 'merged',
      url: 'https://github.com/a/b/pull/1',
      targetStatus: 'shipped',
    });
    expect(rows().map((r) => JSON.parse(r.state).status)).toEqual([
      'building',
      'shipped',
      'building',
      'shipped',
    ]);
  });
  it('captures checklist, child and archive state and retains statistics after deletion', async () => {
    const task = await createTask(user, 'project-1', {
      title: 'One',
      status: 'ideas',
    });
    const result = await createAcceptanceCriterion(
      'project-1',
      task.id,
      'Pass checks',
      task.updatedAt,
      actor,
    );
    expect(JSON.parse(rows().at(-1)!.state)).toMatchObject({
      criteria: 1,
      checked: 0,
    });
    const current = (await listTasks('project-1'))[0]!;
    expect(result).not.toBeNull();
    await splitTask(user, 'project-1', {
      parentTaskId: task.id,
      expectedUpdatedAt: current.updatedAt,
      titles: ['Child'],
    });
    expect(
      JSON.parse(
        rows()
          .filter((r) => r.task_id === task.id)
          .at(-1)!.state,
      ).openChildren,
    ).toBe(1);
    const parent = (await listTasks('project-1')).find(
      (t) => t.id === task.id,
    )!;
    const archived = await setTaskArchived(
      'project-1',
      task.id,
      true,
      parent.updatedAt,
    );
    await permanentlyDeleteArchivedTask(
      'project-1',
      task.id,
      archived!.updatedAt,
    );
    expect(
      JSON.parse(
        rows()
          .filter((r) => r.task_id === task.id)
          .at(-1)!.state,
      ).deleted,
    ).toBe(true);
    expect(
      JSON.parse(
        rows()
          .filter((r) => r.task_id !== task.id)
          .at(-1)!.state,
      ).parentId,
    ).toBeNull();
  });
  it('records membership removal without losing its earlier history', () => {
    db.sqlite
      .prepare("DELETE FROM project_members WHERE user_id='user-1'")
      .run();
    const events = db.sqlite
      .prepare('SELECT active FROM member_metric_events ORDER BY sequence')
      .all();
    expect(events.map((e) => e.active)).toEqual([1, 0]);
  });
  it('authorizes reports by token project or browser membership and never by supplied project id', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Math.max(Date.now(), Date.parse('2026-10-01T00:00:00Z')));
    const state = JSON.stringify({
      status: 'shipped',
      owners: [user.id],
      due: null,
      parentId: null,
      archived: false,
      deleted: false,
      criteria: 0,
      checked: 0,
      openChildren: 0,
    });
    for (const [project, id] of [
      ['project-1', 'own'],
      ['foreign', 'foreign-one'],
      ['foreign', 'foreign-two'],
    ]) {
      db.sqlite
        .prepare(
          "INSERT INTO task_metric_events(project_id,task_id,occurred_at,kind,state) VALUES (?,?,?,'created',?)",
        )
        .run(project!, id!, Date.parse('2026-09-08T00:00:00Z'), state);
    }
    const url = `${origin}/api/v1/metrics?from=2026-09-07&to=2026-09-13&projectId=foreign`;
    expect((await agentMetrics(new Request(url))).status).toBe(401);
    const response = await agentMetrics(
      new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        coverage: { complete: false },
        team: { completionRate: null, throughput: 1 },
        tasks: { completed: [{ id: 'own' }] },
      },
    });
    const session = await createSessionToken(user, sessionSecret);
    const headers = { cookie: `${SESSION_COOKIE}=${session}` };
    expect((await browserMetrics(new Request(url, { headers }))).status).toBe(
      403,
    );
    expect(
      (
        await browserMetrics(
          new Request(url.replace('projectId=foreign', 'projectId=project-1'), {
            headers,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await agentMetrics(
          new Request(url.replace('2026-09-07', 'bad'), {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(400);
  });
  it('reads archived unified activity beyond twenty records without cross-project leakage', async () => {
    const task = await createTask(user, 'project-1', {
      title: 'Activity',
      status: 'ideas',
    });
    for (let i = 0; i < 55; i++)
      await appendTaskActivity({
        id: `event-${String(i).padStart(3, '0')}`,
        projectId: 'project-1',
        taskId: task.id,
        source: i % 2 ? 'agent' : 'user',
        kind: 'comment.created',
        actorName: 'Alice',
        summary: `Entry ${i}`,
        createdAt: 100,
      });
    await appendTaskActivity({
      projectId: 'foreign',
      taskId: 'foreign-task',
      source: 'user',
      kind: 'comment.created',
      actorName: 'Other',
      summary: 'Foreign',
      createdAt: 200,
    });
    await setTaskArchived('project-1', task.id, true, task.updatedAt);
    const headers = { Authorization: `Bearer ${token}` };
    const url = `${origin}/api/v1/activity?task=${task.id}`;
    const page1 = (await (
      await activity(new Request(url, { headers }))
    ).json()) as { data: { events: { id: string }[]; nextCursor: string } };
    expect(page1.data.events).toHaveLength(50);
    const page2 = (await (
      await activity(
        new Request(
          `${url}&cursor=${encodeURIComponent(page1.data.nextCursor)}`,
          { headers },
        ),
      )
    ).json()) as { data: { events: { id: string }[]; nextCursor: null } };
    expect(page2.data.events).toHaveLength(5);
    expect(page2.data.nextCursor).toBeNull();
    expect(
      new Set([...page1.data.events, ...page2.data.events].map((e) => e.id))
        .size,
    ).toBe(55);
    expect((await activity(new Request(url))).status).toBe(401);
    expect(
      (
        await activity(
          new Request(`${origin}/api/v1/activity?task=foreign-task`, {
            headers,
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await activity(new Request(`${url}&limit=99`, { headers }))).status,
    ).toBe(400);
    expect(
      (await activity(new Request(`${url}&cursor=bad`, { headers }))).status,
    ).toBe(400);
    const all = (await (
      await activity(new Request(`${origin}/api/v1/activity`, { headers }))
    ).json()) as { data: { events: { summary: string }[] } };
    expect(all.data.events.some((e) => e.summary === 'Foreign')).toBe(false);
  });
  it('fails visibly instead of returning a truncated history or guessing a missing baseline', async () => {
    db.sqlite.exec(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<50001) INSERT INTO member_metric_events (project_id,user_id,name,occurred_at,active) SELECT 'project-1','a','A',x,1 FROM n;",
    );
    await expect(readTeamMetrics('project-1', period())).rejects.toBeInstanceOf(
      MetricCapacityError,
    );
    const response = await agentMetrics(
      new Request(`${origin}/api/v1/metrics?from=2026-09-01&to=2026-09-30`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).toBe(422);
    db.sqlite.exec('DELETE FROM metric_coverage');
    await expect(readTeamMetrics('project-1', period())).rejects.toThrow(
      'baseline',
    );
  });
  it('loads real task and roster rows from the journal, even when card updatedAt is rewritten', async () => {
    const task = await createTask(user, 'project-1', {
      title: 'One',
      status: 'building',
    });
    await reorderTasks('project-1', [
      { id: task.id, status: 'shipped', position: 0 },
    ]);
    const now = Date.now();
    const from = new Date(now - 86400000).toISOString().slice(0, 10);
    const to = new Date(now + 86400000).toISOString().slice(0, 10);
    vi.useFakeTimers();
    vi.setSystemTime(now + 1000);
    const result = await readTeamMetrics('project-1', metricPeriod(from, to));
    expect(result.team.throughput).toBe(1);
    expect(result.people.find((p) => p.id === user.id)).toMatchObject({
      completionCredit: 1,
    });
    expect(result.tasks.completed[0]?.id).toBe(task.id);
  });
  it('rejects unauthorized reads and propagates unexpected storage failures', async () => {
    expect(
      (
        await browserMetrics(
          new Request(`${origin}/api/metrics?projectId=project-1`),
        )
      ).status,
    ).toBe(403);
    db.sqlite.exec("UPDATE agent_tokens SET scopes='task:write'");
    expect(
      (
        await agentMetrics(
          new Request(`${origin}/api/v1/metrics`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(401);
    db.sqlite.exec("UPDATE agent_tokens SET scopes='task:read'");
    vi.spyOn(activityStore, 'listTaskActivity').mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      activity(
        new Request(`${origin}/api/v1/activity`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    ).rejects.toThrow('database unavailable');
    db.sqlite.exec('DROP TABLE task_metric_events');
    await expect(
      metricsResponse(
        new Request(`${origin}/api/metrics?from=2026-09-01&to=2026-09-30`),
        'project-1',
      ),
    ).rejects.toThrow();
  });
  it('baselines an existing shipped card without fabricating its earlier completion', () => {
    const legacy = new TestD1Database();
    try {
      for (const file of readdirSync('drizzle')
        .filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.startsWith('0015_'))
        .sort()) {
        for (const sql of readFileSync(join('drizzle', file), 'utf8')
          .split('--> statement-breakpoint')
          .filter((s) => s.trim()))
          legacy.exec(sql);
      }
      seedProject(legacy);
      legacy.sqlite.exec(
        "INSERT INTO tasks(id,project_id,title,note,tag,owner_id,owner_login,owner_name,due,status,position,created_at,updated_at,created_by) VALUES ('old-task','project-1','Old title','','产品','user-1','alice','Alice','2026-09-01','shipped',0,1,2,'user-1')",
      );
      for (const sql of readFileSync('drizzle/0015_team_metrics.sql', 'utf8')
        .split('--> statement-breakpoint')
        .filter((s) => s.trim()))
        legacy.exec(sql);
      const row = legacy.sqlite
        .prepare('SELECT kind,state,occurred_at FROM task_metric_events')
        .get()!;
      expect(row.kind).toBe('baseline');
      expect(Number(row.occurred_at)).toBeGreaterThan(2);
      expect(JSON.parse(String(row.state))).toMatchObject({
        status: 'shipped',
        owners: ['user-1'],
      });
      expect(String(row.state)).not.toContain('Old title');
    } finally {
      legacy.close();
    }
  });
});
