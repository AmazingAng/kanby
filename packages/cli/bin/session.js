import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const kinds = [
  'prompt',
  'note',
  'heartbeat',
  'wait',
  'reply',
  'pause',
  'resume',
  'end',
];
const flags = [
  'id',
  'client',
  'context',
  'task',
  'event-id',
  'revision',
  'reason',
  'request',
  'decision',
  'outcome',
  'summary',
  'cursor',
  'limit',
  'member',
  'from',
  'to',
  'timezone',
];
const allowed = {
  start: ['id', 'client', 'context', 'task'],
  run: ['id', 'client', 'context', 'task'],
  get: [],
  list: ['task', 'member', 'cursor', 'limit'],
  events: ['cursor', 'limit'],
  report: ['from', 'to', 'timezone'],
  ...Object.fromEntries(
    kinds.map((k) => [
      k,
      [
        'event-id',
        'revision',
        'summary',
        ...(k === 'wait' ? ['reason'] : []),
        ...(k === 'reply' ? ['request', 'decision'] : []),
        ...(k === 'end' ? ['outcome'] : []),
      ],
    ]),
  ),
};
function parse(args) {
  const separator = args.indexOf('--');
  const commandArgs = separator < 0 ? args : args.slice(0, separator);
  const child = separator < 0 ? [] : args.slice(separator + 1);
  const positional = [],
    options = {};
  for (let i = 0; i < commandArgs.length; i++) {
    const word = commandArgs[i];
    if (word === '--json') {
      options.json = true;
      continue;
    }
    if (word.startsWith('--')) {
      const key = word.slice(2),
        value = commandArgs[++i];
      if (!flags.includes(key) || !value || value.startsWith('--'))
        throw new Error(`Invalid option or missing value: --${key}`);
      if (key in options) throw new Error(`Duplicate option: --${key}`);
      options[key] = value;
    } else positional.push(word);
  }
  const [command, id] = positional;
  if (!allowed[command]) throw new Error('Unknown session command');
  if (
    positional.length >
    (['start', 'run', 'list', 'report'].includes(command) ? 1 : 2)
  )
    throw new Error('Too many session arguments');
  if (
    Object.keys(options).some(
      (k) => k !== 'json' && !allowed[command].includes(k),
    )
  )
    throw new Error('Option is not supported for this session command');
  if (child.length && command !== 'run')
    throw new Error('Only session run accepts a child command');
  if (command === 'run' && (!child.length || options.json))
    throw new Error(
      'session run requires -- <command>; --json is not supported with child output',
    );
  return { command, id: id || process.env.KANBY_SESSION_ID, options, child };
}
function format(data) {
  if (data.people)
    return [
      'Observed sessions only; missing telemetry is unknown. Latency is calendar time, not review quality.',
      ...data.people.map(
        (p) =>
          `${p.name}\tsessions ${p.sessions}\twaiting ${p.pendingWaits}\toldest ${Math.round(p.oldestWaitMs / 60000)}m\tstale ${p.staleSessions}\treported replies ${p.reportedResponses.count}\tverified replies ${p.verifiedResponses.count}`,
      ),
    ].join('\n');
  if (data.sessions)
    return [
      ...data.sessions.map(format),
      data.nextCursor ? `Next cursor: ${data.nextCursor}` : 'End of sessions',
    ].join('\n');
  if (data.events)
    return [
      ...data.events.map(
        (e) =>
          `${e.sequence}\t${e.kind}\t${e.provenance}\t${new Date(e.at).toISOString()}${e.summary ? '\t' + e.summary : ''}`,
      ),
      data.nextCursor === null
        ? 'End of events'
        : `Next cursor: ${data.nextCursor}`,
    ].join('\n');
  return `${data.id}\t${data.status}\t${data.userName}\t${data.client}\trevision ${data.revision}\t${data.liveness}${data.wait ? `\twait ${data.wait.id} (${data.wait.reason})` : ''}`;
}
export async function sessionCommand(args, api) {
  const { command, id, options: o, child } = parse(args);
  const output = (data) =>
    console.log(o.json ? JSON.stringify(data, null, 2) : format(data));
  const read = (id) =>
    api(`/api/v1/sessions?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(15000),
    });
  const send = async (body) => {
    try {
      return await api('/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      error.message +=
        body.action === 'start'
          ? ` (retry session start with --id ${body.id})`
          : ` (session ${body.sessionId}; retry the same payload with --event-id ${body.eventId} --revision ${body.revision})`;
      throw error;
    }
  };
  const append = async (sessionId, kind, extra = {}) => {
    const revision =
      o.revision === undefined
        ? (await read(sessionId)).revision
        : Number(o.revision);
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new Error('--revision must be a nonnegative integer');
    return send({
      action: 'event',
      sessionId,
      revision,
      eventId: o['event-id'] || randomUUID(),
      kind,
      ...extra,
    });
  };
  if (command === 'start' || command === 'run') {
    if (!o.client)
      throw new Error(
        '--client is required (for example codex or claude-code)',
      );
    const sessionId = o.id || randomUUID();
    const session = await send({
      action: 'start',
      id: sessionId,
      client: o.client,
      context: o.context,
      task: o.task,
    });
    if (command === 'start') {
      output(session);
      return;
    }
    if (
      session.replayed ||
      session.revision !== 0 ||
      session.status !== 'running'
    )
      throw new Error('session run needs a new session ID');
    console.error(`Kanby session: ${sessionId}`);
    await runProcess(child, sessionId, append, read);
    return;
  }
  if (['get', 'events', ...kinds].includes(command) && !id)
    throw new Error('Session ID or KANBY_SESSION_ID is required');
  if (command === 'get') {
    output(await read(id));
    return;
  }
  if (command === 'list' || command === 'events' || command === 'report') {
    const params = new URLSearchParams();
    if (command !== 'list') params.set('view', command);
    if (command === 'events') params.set('id', id);
    for (const key of allowed[command])
      if (o[key] !== undefined) params.set(key, o[key]);
    output(
      await api(`/api/v1/sessions?${params}`, {
        signal: AbortSignal.timeout(15000),
      }),
    );
    return;
  }
  const extra = {
    summary: o.summary,
    reason: o.reason,
    requestId: o.request,
    decision: o.decision,
    outcome: o.outcome,
  };
  output(await append(id, command, extra));
}
async function runProcess(args, sessionId, append, read) {
  let pending = Promise.resolve(),
    busy = false,
    telemetryFailed = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    pending = append(sessionId, 'heartbeat')
      .catch(() => {
        telemetryFailed = true;
        console.error(
          'Kanby heartbeat failed; collection has a gap. Child process continues.',
        );
      })
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(tick, 60000);
  const processChild = spawn(args[0], args.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, KANBY_SESSION_ID: sessionId },
  });
  const interrupt = () => processChild.kill('SIGINT');
  const terminate = () => processChild.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      processChild.once('error', reject);
      processChild.once('close', (code, signal) => resolve({ code, signal }));
    });
  } catch (error) {
    await pending;
    await append(sessionId, 'end', { outcome: 'failed' });
    throw error;
  } finally {
    clearInterval(timer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
  await pending;
  // Child stdout/stderr and input are never parsed or uploaded as interaction evidence.
  let current = await read(sessionId);
  if (result.code === 0 && current.status === 'running')
    current = await append(sessionId, 'wait', { reason: 'acceptance' });
  else if (result.code !== 0 && current.status !== 'ended')
    current = await append(sessionId, 'end', {
      outcome: result.signal ? 'cancelled' : 'failed',
    });
  console.error(`Kanby session ${sessionId}: ${current.status}`);
  process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 143);
  if (telemetryFailed && process.exitCode === 0) process.exitCode = 1;
}
