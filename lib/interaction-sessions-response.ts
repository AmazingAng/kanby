import type { AgentIdentity } from './agent';
import {
  allowFields,
  identifier,
  parseEvent,
  SessionError,
  textField,
} from './interaction-sessions';
import {
  appendSessionEvent,
  listSessionEvents,
  listSessions,
  sessionRow,
  sessionView,
  startSession,
} from './interaction-sessions-store';
import { sessionReport } from './interaction-sessions-report';
import { MetricInputError, metricPeriod } from './team-metrics';
import { isJsonContentType, readJsonObjectWithLimit } from './request-limits';
export function sessionResponse(data: unknown, status = 200) {
  return Response.json(
    { ok: true, data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
export function sessionFailure(error: unknown): Response {
  if (!(error instanceof SessionError) && !(error instanceof MetricInputError))
    throw error;
  return Response.json(
    { ok: false, error: { message: error.message } },
    {
      status: error instanceof SessionError ? error.status : 400,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
export async function sessionBody(request: Request) {
  if (!isJsonContentType(request)) throw new SessionError(415, 'JSON required');
  const parsed = await readJsonObjectWithLimit(request, 16 * 1024);
  if (!parsed.ok)
    throw new SessionError(
      parsed.reason === 'too_large' ? 413 : 400,
      parsed.reason === 'too_large' ? 'Payload too large' : 'Invalid JSON',
    );
  return parsed.body;
}
export async function readSessions(request: Request, projectId: string) {
  const params = new URL(request.url).searchParams;
  switch (params.get('view')) {
    case 'report':
      return sessionResponse(
        await sessionReport(
          projectId,
          metricPeriod(
            params.get('from') ?? '',
            params.get('to') ?? '',
            params.get('timezone') ?? 'UTC',
          ),
        ),
      );
    case 'events':
      return sessionResponse(
        await listSessionEvents(
          projectId,
          identifier(params.get('id')),
          params,
        ),
      );
    case null:
      return sessionResponse(
        params.has('id')
          ? sessionView(
              await sessionRow(projectId, identifier(params.get('id'))),
            )
          : await listSessions(projectId, params),
      );
    default:
      throw new SessionError(400, 'Unknown session view');
  }
}
export function eventInput(body: Record<string, unknown>, human = false) {
  allowFields(body, [
    'action',
    'sessionId',
    'eventId',
    'revision',
    'kind',
    'summary',
    'reason',
    'requestId',
    'decision',
    'outcome',
    ...(human ? ['projectId'] : []),
  ]);
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
    throw new SessionError(400, 'Expected revision is required');
  return {
    sessionId: identifier(body.sessionId),
    eventId: identifier(body.eventId),
    revision: body.revision as number,
    event: parseEvent(body),
  };
}
export async function writeSessions(request: Request, identity: AgentIdentity) {
  const body = await sessionBody(request);
  if (body.action === 'start') {
    allowFields(body, ['action', 'id', 'client', 'context', 'task']);
    return sessionResponse(
      await startSession(identity, {
        id: identifier(body.id),
        client: textField(body.client, 60, true)!,
        context: textField(body.context, 160),
        task: textField(body.task, 80),
      }),
      201,
    );
  }
  if (body.action !== 'event')
    throw new SessionError(400, 'Unknown session action');
  return sessionResponse(
    await appendSessionEvent(
      identity.projectId,
      identity.userId,
      'agent_reported',
      eventInput(body),
    ),
  );
}
