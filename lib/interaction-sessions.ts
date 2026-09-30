export class SessionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const STALE_AFTER_MS = 5 * 60_000;
export const EVENT_KINDS = [
  'prompt',
  'note',
  'heartbeat',
  'wait',
  'reply',
  'pause',
  'resume',
  'end',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type Provenance = 'agent_reported' | 'verified_user';
export type SessionState = {
  status: 'running' | 'waiting' | 'paused' | 'ended';
  wait: { id: string; reason: string; since: number } | null;
  heartbeatAt: number;
  endedAt: number | null;
  outcome: string | null;
};
export type SessionEventInput = {
  kind: EventKind;
  summary: string | null;
  reason: string | null;
  requestId: string | null;
  decision: string | null;
  outcome: string | null;
};
export type SessionEvent = SessionEventInput & {
  id: string;
  sessionId: string;
  sequence: number;
  at: number;
  actorId: string;
  provenance: Provenance;
};
export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new SessionError(400, 'A UUID is required');
  return value.toLowerCase();
}
export function textField(
  value: unknown,
  max: number,
  required = false,
): string | null {
  if (value === undefined || value === null) {
    if (required) throw new SessionError(400, 'Required text is missing');
    return null;
  }
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value
      .split('')
      .some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new SessionError(400, 'Invalid text field');
  return value.trim();
}
export function allowFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((k) => !allowed.includes(k)))
    throw new SessionError(400, 'Unsupported field');
}
export function parseEvent(body: Record<string, unknown>): SessionEventInput {
  if (!EVENT_KINDS.includes(body.kind as EventKind))
    throw new SessionError(400, 'Invalid event kind');
  const kind = body.kind as EventKind;
  const result = {
    kind,
    summary: textField(body.summary, 500),
    reason: textField(body.reason, 20),
    requestId: body.requestId === undefined ? null : identifier(body.requestId),
    decision: textField(body.decision, 20),
    outcome: textField(body.outcome, 20),
  };
  if (
    (kind === 'wait' &&
      !['input', 'review', 'approval', 'acceptance'].includes(
        result.reason ?? '',
      )) ||
    (kind !== 'wait' && result.reason !== null) ||
    (kind === 'reply' &&
      (!result.requestId ||
        !['continue', 'accept', 'changes', 'defer'].includes(
          result.decision ?? '',
        ))) ||
    (kind !== 'reply' &&
      (result.requestId !== null || result.decision !== null)) ||
    (kind === 'end' &&
      !['completed', 'handed-off', 'cancelled', 'failed'].includes(
        result.outcome ?? '',
      )) ||
    (kind !== 'end' && result.outcome !== null)
  )
    throw new SessionError(400, 'Invalid event fields');
  return result;
}
export function initialState(at: number): SessionState {
  return {
    status: 'running',
    wait: null,
    heartbeatAt: at,
    endedAt: null,
    outcome: null,
  };
}
export function transition(
  state: SessionState,
  event: SessionEventInput,
  id: string,
  at: number,
): SessionState {
  if (state.status === 'ended')
    throw new SessionError(409, 'Session has ended');
  const next = { ...state, heartbeatAt: at };
  switch (event.kind) {
    case 'wait':
      if (state.status !== 'running')
        throw new SessionError(409, 'Only a running session can wait');
      next.status = 'waiting';
      next.wait = { id, reason: event.reason!, since: at };
      break;
    case 'reply':
      if (state.status !== 'waiting' || state.wait?.id !== event.requestId)
        throw new SessionError(409, 'Reply does not match the open wait');
      next.status = event.decision === 'defer' ? 'paused' : 'running';
      next.wait = null;
      break;
    case 'pause':
      if (state.status !== 'running')
        throw new SessionError(409, 'Only a running session can pause');
      next.status = 'paused';
      break;
    case 'resume':
      if (state.status !== 'paused')
        throw new SessionError(409, 'Only a paused session can resume');
      next.status = 'running';
      break;
    case 'end':
      next.status = 'ended';
      next.endedAt = at;
      next.outcome = event.outcome;
      next.wait = null;
      break;
    // Prompts and progress are observations, not implicit acknowledgement of an open wait.
    default:
      break;
  }
  return next;
}
export function liveness(state: SessionState, now: number) {
  if (state.status === 'ended') return 'ended';
  return now - state.heartbeatAt > STALE_AFTER_MS ? 'stale' : 'recent';
}
export function responseStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
  return {
    count: sorted.length,
    p50Ms: percentile(0.5),
    p90Ms: percentile(0.9),
  };
}
