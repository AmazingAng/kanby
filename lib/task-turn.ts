import type { AuthUser } from '@/lib/auth';

export const TURN_REASONS = [
  'developing',
  'awaiting_acceptance',
  'awaiting_decision',
  'blocked',
  'awaiting_review',
] as const;
export type TurnReason = (typeof TURN_REASONS)[number];

export const TURN_REASON_LABELS: Record<TurnReason, string> = {
  developing: '开发中',
  awaiting_acceptance: '待验收',
  awaiting_decision: '待决策',
  blocked: '被阻塞',
  awaiting_review: '待复核',
};

export const MAX_TURN_NOTE_LENGTH = 500;
export const MAX_COMMENT_LENGTH = 2000;

export type TurnTarget = {
  kind: 'member' | 'agent';
  userId: string;
  tokenId: string | null;
};

export type TaskTurn = {
  kind: 'member' | 'agent';
  user: AuthUser;
  tokenId: string | null;
  agentName: string | null;
  label: string;
  reason: TurnReason;
  reasonLabel: string;
  note: string | null;
  since: number;
};

export type TurnRow = {
  turn_kind: string | null;
  turn_user_id: string | null;
  turn_token_id: string | null;
  turn_reason: string | null;
  turn_note: string | null;
  turn_since: number | null;
  turn_user_login: string | null;
  turn_user_name: string | null;
  turn_user_avatar_url: string | null;
  turn_agent_name: string | null;
};

export function isTurnReason(value: unknown): value is TurnReason {
  return TURN_REASONS.includes(value as TurnReason);
}

export function agentLabel(userName: string, agentName: string) {
  return `${userName} 的 ${agentName}`;
}

export const TURN_ROW_COLUMNS = `t.turn_kind, t.turn_user_id, t.turn_token_id, t.turn_reason, t.turn_note, t.turn_since,
  tu.login AS turn_user_login, tu.name AS turn_user_name, tu.avatar_url AS turn_user_avatar_url,
  tt.name AS turn_agent_name`;
export const TURN_ROW_JOINS = `LEFT JOIN users tu ON tu.id = t.turn_user_id
  LEFT JOIN agent_tokens tt ON tt.id = t.turn_token_id`;

export function mapTurn(row: TurnRow): TaskTurn | undefined {
  if (
    (row.turn_kind !== 'member' && row.turn_kind !== 'agent') ||
    !row.turn_user_id ||
    !row.turn_user_login ||
    !isTurnReason(row.turn_reason)
  )
    return undefined;
  const user: AuthUser = {
    id: row.turn_user_id,
    login: row.turn_user_login,
    name: row.turn_user_name ?? row.turn_user_login,
    avatarUrl: row.turn_user_avatar_url,
  };
  const agentName =
    row.turn_kind === 'agent' ? (row.turn_agent_name ?? 'agent') : null;
  return {
    kind: row.turn_kind,
    user,
    tokenId: row.turn_kind === 'agent' ? row.turn_token_id : null,
    agentName,
    label: agentName ? agentLabel(user.name, agentName) : user.name,
    reason: row.turn_reason,
    reasonLabel: TURN_REASON_LABELS[row.turn_reason],
    note: row.turn_note,
    since: Number(row.turn_since ?? 0),
  };
}
