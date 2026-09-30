import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/v1/sessions/route';
import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  seedAgentToken,
  seedProject,
  seedTask,
} from './support/fixtures';

let db: TestD1Database;
let token: string;
const epoch = Date.parse('2026-09-30T00:00:00Z');
const json = async (r: Response) => JSON.parse(await r.text());
const secret = 's'.repeat(48);
const headers = () => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});
const post = (body: unknown, auth = headers()) =>
  POST(
    new Request(`${origin}/api/v1/sessions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    }),
  );
const get = (query = '', auth = headers()) =>
  GET(new Request(`${origin}/api/v1/sessions?${query}`, { headers: auth }));
async function start(extra = {}) {
  const response = await post({
    action: 'start',
    id: randomUUID(),
    client: 'test-agent',
    ...extra,
  });
  expect(response.status).toBe(201);
  return (await json(response)).data;
}
async function event(
  session: { id: string; revision: number },
  kind: string,
  extra = {},
) {
  return post({
    action: 'event',
    sessionId: session.id,
    revision: session.revision,
    eventId: randomUUID(),
    kind,
    ...extra,
  });
}
async function next(
  session: { id: string; revision: number },
  kind: string,
  extra = {},
) {
  const response = await event(session, kind, extra);
  expect(response.status).toBe(200);
  return (await json(response)).data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(epoch);
  db = createMigratedDatabase();
  configureEnvironment(db);
  seedProject(db);
  seedTask(db);
  token = seedAgentToken(db, randomUUID(), secret, 'Coding Agent');
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('interaction sessions contract', () => {
  it('starts project-only and task sessions without changing cards or claims', async () => {
    const project = await start();
    const task = await start({ task: 'task-00000001' });
    expect(project).toMatchObject({
      projectId: 'project-1',
      userId: 'user-1',
      taskId: null,
      status: 'running',
      revision: 0,
    });
    expect(task.taskId).toBe('task-00000001');
    expect(db.sqlite.prepare('SELECT status FROM tasks').get()).toMatchObject({
      status: 'ideas',
    });
    expect(
      db.sqlite.prepare('SELECT count(*) AS n FROM task_agent_claims').get(),
    ).toMatchObject({ n: 0 });
  });
  it('deduplicates start and event replay, rejecting payload reuse and stale revisions', async () => {
    const body = { action: 'start', id: randomUUID(), client: 'test-agent' };
    const responses = await Promise.all([post(body), post(body)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const session = (await json(responses[0])).data;
    expect((await post({ ...body, client: 'other' })).status).toBe(409);
    const body2 = {
      action: 'event',
      sessionId: session.id,
      revision: 0,
      eventId: randomUUID(),
      kind: 'prompt',
    };
    const writes = await Promise.all([post(body2), post(body2)]);
    expect(writes.map((r) => r.status)).toEqual([200, 200]);
    let current = (await json(writes[0])).data;
    current = await next(current, 'note');
    expect((await post(body2)).status).toBe(200);
    expect(
      (await post({ ...body2, kind: 'end', outcome: 'completed' })).status,
    ).toBe(409);
    expect((await event(session, 'pause')).status).toBe(409);
    const history = await json(await get(`view=events&id=${session.id}`));
    expect(history.data.events.map((e: { kind: string }) => e.kind)).toEqual([
      'start',
      'prompt',
      'note',
    ]);
    expect(current.revision).toBe(2);
  });
  it('correlates replies with open waits and never labels token reports verified', async () => {
    let s = await start();
    s = await next(s, 'wait', { reason: 'review' });
    const requestId = s.wait.id;
    expect(
      (await event(s, 'reply', { requestId: randomUUID(), decision: 'accept' }))
        .status,
    ).toBe(409);
    expect((await event(s, 'wait', { reason: 'input' })).status).toBe(409);
    expect((await event(s, 'resume')).status).toBe(409);
    vi.setSystemTime(epoch + 60_000);
    s = await next(s, 'heartbeat');
    expect(s.wait.id).toBe(requestId);
    s = await next(s, 'reply', { requestId, decision: 'changes' });
    expect(s).toMatchObject({ status: 'running', wait: null });
    const history = (await json(await get(`view=events&id=${s.id}`))).data
      .events;
    expect(history.at(-1)).toMatchObject({
      provenance: 'agent_reported',
      actorId: 'user-1',
    });
    expect(
      (await event(s, 'prompt', { provenance: 'verified_user' })).status,
    ).toBe(400);
  });
  it('marks stale sessions unknown and preserves unresolved end as cancelled', async () => {
    let s = await start();
    vi.setSystemTime(epoch + 300_001);
    expect((await json(await get(`id=${s.id}`))).data).toMatchObject({
      liveness: 'stale',
      status: 'running',
      endedAt: null,
    });
    s = await next(s, 'wait', { reason: 'input' });
    vi.setSystemTime(epoch + 900_000);
    s = await next(s, 'end', { outcome: 'cancelled' });
    expect(s).toMatchObject({ status: 'ended', outcome: 'cancelled' });
    expect((await event(s, 'heartbeat')).status).toBe(409);
    const r = (
      await json(await get('view=report&from=2026-09-30&to=2026-09-30'))
    ).data;
    expect(r.people[0]).toMatchObject({
      cancelledWaits: 1,
      reportedResponses: { count: 0, p50Ms: null, p90Ms: null },
    });
  });
  it('isolates project reads, task association, member writes and scopes', async () => {
    const s = await start();
    db.sqlite.exec(
      "INSERT INTO users (id, login, name, created_at, updated_at) VALUES ('user-2','bob','Bob',1,1); INSERT INTO projects (id,name,slug,owner_id,created_at,updated_at) VALUES ('project-2','Other','other','user-2',1,1); INSERT INTO project_members (project_id,user_id,role,created_at) VALUES ('project-2','user-2','owner',1),('project-1','user-2','member',1)",
    );
    const otherId = randomUUID();
    const other = seedAgentToken(db, otherId, secret, 'Other');
    db.sqlite
      .prepare("UPDATE agent_tokens SET user_id='user-2' WHERE id=?")
      .run(otherId);
    const otherHeaders = {
      Authorization: `Bearer ${other}`,
      'Content-Type': 'application/json',
    };
    expect(
      (
        await post(
          {
            action: 'event',
            sessionId: s.id,
            revision: 0,
            eventId: randomUUID(),
            kind: 'end',
            outcome: 'completed',
          },
          otherHeaders,
        )
      ).status,
    ).toBe(403);
    expect((await get(`id=${s.id}`, otherHeaders)).status).toBe(200);
    db.sqlite
      .prepare("UPDATE agent_tokens SET project_id='project-2' WHERE id=?")
      .run(otherId);
    expect((await get(`id=${s.id}`, otherHeaders)).status).toBe(404);
    expect(
      (
        await post(
          {
            action: 'start',
            id: randomUUID(),
            client: 'test',
            task: 'task-00000001',
          },
          otherHeaders,
        )
      ).status,
    ).toBe(404);
    db.sqlite
      .prepare("UPDATE agent_tokens SET scopes='task:read' WHERE id=?")
      .run(otherId);
    expect(
      (
        await post(
          { action: 'start', id: randomUUID(), client: 'test' },
          otherHeaders,
        )
      ).status,
    ).toBe(401);
    db.sqlite
      .prepare('UPDATE agent_tokens SET revoked_at=1 WHERE id=?')
      .run(otherId);
    expect((await get('', otherHeaders)).status).toBe(401);
  });
  it('rejects hostile input and paginates tied timestamps without omissions', async () => {
    expect(
      (
        await post({
          action: 'start',
          id: randomUUID(),
          client: 'test',
          userId: 'someone',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          action: 'start',
          id: randomUUID(),
          client: 'x'.repeat(100),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          action: 'start',
          id: randomUUID(),
          client: 'test',
          context: 'x'.repeat(17000),
        })
      ).status,
    ).toBe(413);
    const a = await start(),
      b = await start(),
      c = await start();
    const p1 = (await json(await get('limit=2'))).data;
    const p2 = (
      await json(
        await get(`limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`),
      )
    ).data;
    expect(
      new Set(
        [...p1.sessions, ...p2.sessions].map((s: { id: string }) => s.id),
      ),
    ).toEqual(new Set([a.id, b.id, c.id]));
    expect(p2.nextCursor).toBe(null);
    expect((await get('cursor=bad')).status).toBe(400);
    expect((await get('limit=0')).status).toBe(400);
  });
  it('reports pending waits separately from observed response latency', async () => {
    let a = await start();
    a = await next(a, 'wait', { reason: 'review' });
    let b = await start();
    b = await next(b, 'wait', { reason: 'input' });
    vi.setSystemTime(epoch + 120000);
    a = await next(a, 'reply', { requestId: a.wait.id, decision: 'accept' });
    const r = (
      await json(
        await get(
          'view=report&from=2026-09-30&to=2026-09-30&timezone=Asia%2FShanghai',
        ),
      )
    ).data;
    expect(r.people[0]).toMatchObject({
      sessions: 2,
      pendingWaits: 1,
      oldestWaitMs: 120000,
      reportedResponses: { count: 1, p50Ms: 120000, p90Ms: 120000 },
      verifiedResponses: { count: 0, p50Ms: null, p90Ms: null },
    });
    expect(r.coverage).toMatchObject({
      complete: false,
      source: 'instrumented_sessions_only',
    });
    expect(
      (await get('view=report&from=2026-02-30&to=2026-09-30')).status,
    ).toBe(400);
  });
});

it('handles pauses, explicit deferral, task filters and a second wait independently', async () => {
  let s = await start({ task: 'task-00000001', context: 'Feature review' });
  expect(
    (await event(s, 'reply', { requestId: randomUUID(), decision: 'accept' }))
      .status,
  ).toBe(409);
  s = await next(s, 'pause');
  expect(s.status).toBe('paused');
  expect((await event(s, 'wait', { reason: 'review' })).status).toBe(409);
  expect((await event(s, 'pause')).status).toBe(409);
  s = await next(s, 'resume');
  s = await next(s, 'wait', { reason: 'input' });
  const old = s.wait.id;
  s = await next(s, 'reply', { requestId: old, decision: 'defer' });
  expect(s.status).toBe('paused');
  s = await next(s, 'resume');
  s = await next(s, 'wait', { reason: 'review' });
  expect(
    (await event(s, 'reply', { requestId: old, decision: 'accept' })).status,
  ).toBe(409);
  s = await next(s, 'prompt');
  expect(s.status).toBe('waiting');
  const page = (await json(await get('task=task-00000001&member=user-1'))).data;
  expect(page.sessions.map((x: { id: string }) => x.id)).toEqual([s.id]);
  expect((await json(await get('member=someone'))).data.sessions).toEqual([]);
  expect((await get('task=missing')).status).toBe(404);
  const first = (await json(await get(`view=events&id=${s.id}&limit=2`))).data;
  const second = (
    await json(
      await get(`view=events&id=${s.id}&limit=2&cursor=${first.nextCursor}`),
    )
  ).data;
  expect(first.events.map((x: { sequence: number }) => x.sequence)).toEqual([
    0, 1,
  ]);
  expect(second.events.map((x: { sequence: number }) => x.sequence)).toEqual([
    2, 3,
  ]);
  expect((await get(`view=events&id=${s.id}&cursor=bad`)).status).toBe(400);
});

it('rejects invalid fields, malformed bodies, unknown views and missing authentication', async () => {
  const s = await start();
  for (const extra of [
    { kind: 'fake' },
    { kind: 'wait' },
    { kind: 'wait', reason: 'fake' },
    { kind: 'reply', requestId: randomUUID() },
    { kind: 'end' },
    { kind: 'end', outcome: 'fake' },
    { kind: 'note', reason: 'input' },
    { kind: 'note', decision: 'accept' },
    { kind: 'note', outcome: 'completed' },
    { kind: 'note', summary: '\u0000' },
    { kind: 'note', summary: 42 },
    { kind: 'reply', requestId: 'bad', decision: 'accept' },
  ])
    expect(
      (
        await post({
          action: 'event',
          sessionId: s.id,
          revision: 0,
          eventId: randomUUID(),
          ...extra,
        })
      ).status,
    ).toBe(400);
  for (const extra of [
    { revision: -1 },
    { revision: 1.5 },
    { revision: '0' },
    { eventId: 'bad' },
    { sessionId: 'bad' },
    { actorId: 'fake' },
  ])
    expect(
      (
        await post({
          action: 'event',
          sessionId: s.id,
          revision: 0,
          eventId: randomUUID(),
          kind: 'note',
          ...extra,
        })
      ).status,
    ).toBe(400);
  expect((await post({ action: 'start', id: randomUUID() })).status).toBe(400);
  expect((await post({ action: 'bad' })).status).toBe(400);
  expect((await get('view=fake')).status).toBe(400);
  expect((await get('id=bad')).status).toBe(400);
  expect(
    (await get('', { 'Content-Type': 'application/json', Authorization: '' }))
      .status,
  ).toBe(401);
  expect(
    (await post({}, { 'Content-Type': 'application/json', Authorization: '' }))
      .status,
  ).toBe(401);
  expect(
    (await post({}, { ...headers(), 'Content-Type': 'text/plain' })).status,
  ).toBe(415);
  expect(
    (
      await POST(
        new Request(`${origin}/api/v1/sessions`, {
          method: 'POST',
          headers: headers(),
          body: '{',
        }),
      )
    ).status,
  ).toBe(400);
});

it('commits exactly one competing transition and rolls back the state on an event write failure', async () => {
  const s = await start();
  const responses = await Promise.all([
    event(s, 'wait', { reason: 'review' }),
    event(s, 'pause'),
  ]);
  expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
    200, 409,
  ]);
  const before = (await json(await get(`id=${s.id}`))).data;
  db.sqlite.exec(
    "CREATE TRIGGER reject_interaction_event BEFORE INSERT ON interaction_events BEGIN SELECT RAISE(ABORT, 'injected write fault'); END",
  );
  await expect(event(before, 'note')).rejects.toThrow('injected write fault');
  expect((await json(await get(`id=${s.id}`))).data).toEqual(before);
  expect(
    (await json(await get(`view=events&id=${s.id}`))).data.events,
  ).toHaveLength(2);
});

it('separates authenticated human responses from reported replies and rejects CSRF or membership forgery', async () => {
  const { POST: humanPost, GET: humanGet } =
    await import('@/app/api/sessions/route');
  const { createSessionToken, SESSION_COOKIE } = await import('@/lib/auth');
  const { sessionSecret } = await import('./support/fixtures');
  const cookie = await createSessionToken(
    { id: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null },
    sessionSecret,
  );
  const humanHeaders = {
    'Content-Type': 'application/json',
    Origin: origin,
    Cookie: `${SESSION_COOKIE}=${cookie}`,
  };
  const request = (body: unknown, h = humanHeaders) =>
    new Request(`${origin}/api/sessions`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
  let s = await start();
  s = await next(s, 'wait', { reason: 'approval' });
  vi.setSystemTime(epoch + 60000);
  const body = {
    action: 'event',
    projectId: 'project-1',
    sessionId: s.id,
    revision: s.revision,
    eventId: randomUUID(),
    kind: 'reply',
    requestId: s.wait.id,
    decision: 'accept',
  };
  expect(
    (
      await humanPost(
        request(body, { ...humanHeaders, Origin: 'https://evil.test' }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await humanPost(request({ ...body, projectId: 'other' }))).status,
  ).toBe(403);
  expect((await humanPost(request({ ...body, actorId: 'other' }))).status).toBe(
    400,
  );
  expect(
    (
      await humanPost(
        request({
          ...body,
          kind: 'note',
          decision: undefined,
          requestId: undefined,
        }),
      )
    ).status,
  ).toBe(400);
  expect((await humanPost(request(body))).status).toBe(200);
  expect((await humanPost(request(body))).status).toBe(200);
  const h = (await json(await get(`view=events&id=${s.id}`))).data.events;
  expect(h.at(-1)).toMatchObject({
    provenance: 'verified_user',
    actorId: 'user-1',
  });
  const r = (await json(await get('view=report&from=2026-09-30&to=2026-09-30')))
    .data;
  expect(r.people[0].verifiedResponses).toEqual({
    count: 1,
    p50Ms: 60000,
    p90Ms: 60000,
  });
  expect(r.people[0].reportedResponses.count).toBe(0);
  expect(
    (
      await humanGet(
        new Request(`${origin}/api/sessions?projectId=project-1`, {
          headers: humanHeaders,
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await humanGet(
        new Request(`${origin}/api/sessions?projectId=other`, {
          headers: humanHeaders,
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await humanGet(new Request(`${origin}/api/sessions?projectId=project-1`)))
      .status,
  ).toBe(403);
  expect(
    (
      await humanPost(
        request(body, {
          'Content-Type': 'application/json',
          Origin: origin,
          Cookie: '',
        }),
      )
    ).status,
  ).toBe(403);
});

it('includes zero-observation members and historical waits without including events at period end', async () => {
  db.sqlite.exec(
    "INSERT INTO users (id,login,name,created_at,updated_at) VALUES ('user-2','bob','Bob',1,1); INSERT INTO project_members (project_id,user_id,role,created_at) VALUES ('project-1','user-2','member',1)",
  );
  vi.setSystemTime(epoch - 3600000);
  let s = await start();
  s = await next(s, 'wait', { reason: 'review' });
  vi.setSystemTime(epoch + 60000);
  s = await next(s, 'reply', { requestId: s.wait.id, decision: 'continue' });
  s = await next(s, 'prompt');
  s = await next(s, 'pause');
  vi.setSystemTime(epoch + 86400000);
  s = await next(s, 'end', { outcome: 'completed' });
  const r = (await json(await get('view=report&from=2026-09-30&to=2026-09-30')))
    .data;
  expect(r.people.find((p: { id: string }) => p.id === 'user-1')).toMatchObject(
    {
      sessions: 1,
      paused: 1,
      ended: 0,
      reportedPrompts: 1,
      reportedResponses: { count: 1, p50Ms: 3660000 },
    },
  );
  expect(r.people.find((p: { id: string }) => p.id === 'user-2')).toMatchObject(
    { sessions: 0, reportedResponses: { count: 0, p50Ms: null } },
  );
  db.sqlite.exec("DELETE FROM project_members WHERE user_id='user-1'");
  // Historical attribution remains in the stored snapshot, even if the owner leaves.
  const { sessionReport } = await import('@/lib/interaction-sessions-report');
  const { metricPeriod } = await import('@/lib/team-metrics');
  expect(
    (
      await sessionReport('project-1', metricPeriod('2026-09-30', '2026-09-30'))
    ).people.find((p) => p.id === 'user-1')?.sessions,
  ).toBe(1);
});

it('fails visibly at the report capacity limit rather than returning truncated totals', async () => {
  const s = await start();
  const insert = db.sqlite.prepare(
    "INSERT INTO interaction_events (session_id,id,sequence,created_at,kind,actor_id,provenance,input_json,fingerprint) VALUES (?,?,?,?,'note','user-1','agent_reported',?,?)",
  );
  for (let i = 1; i <= 10000; i++)
    insert.run(
      s.id,
      randomUUID(),
      i,
      epoch,
      JSON.stringify({
        kind: 'note',
        summary: null,
        reason: null,
        requestId: null,
        decision: null,
        outcome: null,
      }),
      String(i),
    );
  vi.setSystemTime(epoch + 1);
  expect((await get('view=report&from=2026-09-30&to=2026-09-30')).status).toBe(
    422,
  );
});

it('replays ordered transitions with nonnegative response durations across generated intervals', async () => {
  const fc = await import('fast-check');
  const { summarizeSessions } =
    await import('@/lib/interaction-sessions-report');
  const { metricPeriod } = await import('@/lib/team-metrics');
  const period = metricPeriod('2026-09-30', '2026-09-30');
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 60000 }), {
        minLength: 1,
        maxLength: 20,
      }),
      (delays) => {
        let at = epoch;
        let seq = 0;
        const rows = [
          {
            session_id: 's',
            user_id: 'u',
            user_name: 'U',
            created_at: at,
            kind: 'start',
            id: 's',
            provenance: 'agent_reported' as const,
            input_json: '{}',
            sequence: seq++,
          },
        ];
        for (const delay of delays) {
          const id = `wait-${seq}`;
          rows.push({
            ...rows[0],
            id,
            kind: 'wait',
            created_at: at,
            sequence: seq++,
            input_json: JSON.stringify({ kind: 'wait', reason: 'review' }),
          });
          at += delay;
          rows.push({
            ...rows[0],
            id: `reply-${seq}`,
            kind: 'reply',
            created_at: at,
            sequence: seq++,
            input_json: JSON.stringify({
              kind: 'reply',
              requestId: id,
              decision: 'accept',
            }),
          });
        }
        const r = summarizeSessions(rows, [], period, at);
        const sorted = [...delays].sort((a, b) => a - b);
        expect(r.people[0].reportedResponses).toEqual({
          count: delays.length,
          p50Ms: sorted[Math.ceil(delays.length * 0.5) - 1],
          p90Ms: sorted[Math.ceil(delays.length * 0.9) - 1],
        });
        expect(r.people[0].pendingWaits).toBe(0);
      },
    ),
    { numRuns: 100 },
  );
});

it('resolves real competing store writes using the revision guard, including identical retries', async () => {
  const { appendSessionEvent } =
    await import('@/lib/interaction-sessions-store');
  const s = await start();
  const original = db.batch.bind(db);
  let queue = Promise.resolve();
  vi.spyOn(db, 'batch').mockImplementation((statements) => {
    const result = queue.then(() => original(statements));
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  });
  const input = {
    sessionId: s.id,
    eventId: randomUUID(),
    revision: 0,
    event: {
      kind: 'note' as const,
      summary: null,
      reason: null,
      requestId: null,
      decision: null,
      outcome: null,
    },
  };
  const pair = await Promise.all([
    appendSessionEvent('project-1', 'user-1', 'agent_reported', input),
    appendSessionEvent('project-1', 'user-1', 'agent_reported', input),
  ]);
  expect(pair.map((s) => s.revision)).toEqual([1, 1]);
  const different = await Promise.allSettled([
    appendSessionEvent('project-1', 'user-1', 'agent_reported', {
      ...input,
      eventId: randomUUID(),
      revision: 1,
    }),
    appendSessionEvent('project-1', 'user-1', 'agent_reported', {
      ...input,
      eventId: randomUUID(),
      revision: 1,
    }),
  ]);
  expect(different.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(different.filter((x) => x.status === 'rejected')).toHaveLength(1);
  expect(
    (await json(await get(`view=events&id=${s.id}`))).data.events,
  ).toHaveLength(3);
});

it('reports corrupted missing-start history explicitly instead of inventing response times', async () => {
  let s = await start();
  s = await next(s, 'note');
  db.sqlite
    .prepare('DELETE FROM interaction_events WHERE session_id=? AND sequence=0')
    .run(s.id);
  expect((await get('view=report&from=2026-09-30&to=2026-09-30')).status).toBe(
    422,
  );
});

it('applies and rolls back the additive migration without losing existing tasks or sessions', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(
    'drizzle/0016_interaction_sessions.sql',
    'utf8',
  ).replaceAll('--> statement-breakpoint', '');
  const s = await start();
  db.sqlite.exec(
    'BEGIN; DROP TABLE interaction_events; DROP TABLE interaction_sessions; DROP TABLE interaction_collection;',
  );
  db.sqlite.exec(sql);
  expect(
    db.sqlite.prepare('SELECT count(*) AS n FROM interaction_sessions').get(),
  ).toMatchObject({ n: 0 });
  expect(
    db.sqlite.prepare('SELECT count(*) AS n FROM tasks').get(),
  ).toMatchObject({ n: 1 });
  db.sqlite.exec('ROLLBACK');
  expect((await get(`id=${s.id}`)).status).toBe(200);
  expect(
    db.sqlite.prepare('SELECT count(*) AS n FROM tasks').get(),
  ).toMatchObject({ n: 1 });
});
