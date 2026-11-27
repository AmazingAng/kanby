'use client';

import { useState } from 'react';
import { AtSign, Bot, Hand, LoaderCircle, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  TURN_REASON_LABELS,
  TURN_REASONS,
  type TurnReason,
} from '@/lib/task-turn';

export type ClientTurn = {
  kind: 'member' | 'agent';
  user: { id: string; login: string; name: string; avatarUrl: string | null };
  tokenId: string | null;
  agentName: string | null;
  label: string;
  reason: TurnReason;
  reasonLabel: string;
  note: string | null;
  since: number;
};

export type TurnQueueEntry = {
  type: 'turn' | 'mention';
  taskId: string;
  ref: string;
  title: string;
  status: string;
  since: number;
  turn: ClientTurn | null;
  mention: {
    id: string;
    targetKind: 'member' | 'agent';
    by: string;
    body: string | null;
  } | null;
};

type Member = { id: string; login: string; name: string; pending?: boolean };

export function waitingLabel(since: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

const reasonTone: Record<TurnReason, string> = {
  developing: 'bg-ink/[0.06] text-ink-subtle',
  awaiting_acceptance: 'bg-acid/30 text-ink',
  awaiting_decision: 'bg-[#e7b84a]/25 text-ink',
  blocked: 'bg-[#c94032]/12 text-[#9d3026]',
  awaiting_review: 'bg-child-accent/15 text-ink',
};

export function TurnChip({ turn }: { turn: ClientTurn }) {
  return (
    <div
      className={cn(
        'mt-3 flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium',
        reasonTone[turn.reason],
      )}
      aria-label={`轮到 ${turn.label}，${turn.reasonLabel}`}
    >
      {turn.kind === 'agent' ? (
        <Bot className="size-3 shrink-0" />
      ) : (
        <UserRound className="size-3 shrink-0" />
      )}
      <span className="truncate">
        轮到 {turn.label} · {turn.reasonLabel}
      </span>
      <span className="ml-auto shrink-0 text-[10px] opacity-70">
        {waitingLabel(turn.since)}
      </span>
    </div>
  );
}

export function TurnQueue({
  items,
  currentUserId,
  onOpen,
}: {
  items: TurnQueueEntry[];
  currentUserId: string | null;
  onOpen: (taskId: string) => void;
}) {
  if (items.length === 0)
    return (
      <section className="grid min-h-60 place-items-center rounded-[22px] border border-dashed border-ink/15 bg-card/40 p-8 text-center">
        <div>
          <Hand className="mx-auto size-6 text-ink-faint" />
          <p className="mt-3 text-sm font-semibold">现在没有在等你的卡</p>
          <p className="mt-1 text-xs text-ink-subtle">
            交给你或你的 agent 的卡、@ 你的评论会出现在这里。
          </p>
        </div>
      </section>
    );
  return (
    <section aria-label="轮到我" className="mb-6 space-y-2">
      {items.map((item) => {
        const mine =
          item.turn?.kind === 'member' && item.turn.user.id === currentUserId;
        return (
          <button
            key={`${item.type}-${item.mention?.id ?? item.taskId}`}
            type="button"
            onClick={() => onOpen(item.taskId)}
            className="flex w-full min-w-0 items-start gap-3 rounded-2xl border border-ink/10 bg-card px-4 py-3 text-left shadow-[0_1px_0_rgba(20,20,15,0.04)] hover:border-ink/25"
          >
            <span
              className={cn(
                'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
                item.type === 'mention'
                  ? 'bg-child-accent/15'
                  : item.turn
                    ? reasonTone[item.turn.reason]
                    : 'bg-ink/5',
              )}
            >
              {item.type === 'mention' ? (
                <AtSign className="size-3.5" />
              ) : item.turn?.kind === 'agent' ? (
                <Bot className="size-3.5" />
              ) : (
                <UserRound className="size-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-subtle">
                <span className="font-semibold text-ink">
                  {item.type === 'mention'
                    ? `${item.mention?.by ?? '有人'} @ 了${item.mention?.targetKind === 'agent' ? '你的 agent' : '你'}`
                    : mine
                      ? `轮到你 · ${item.turn?.reasonLabel}`
                      : `轮到 ${item.turn?.label} · ${item.turn?.reasonLabel}`}
                </span>
                <span>{item.ref}</span>
                <span>已等 {waitingLabel(item.since)}</span>
              </span>
              <span className="mt-1 block truncate text-sm font-semibold">
                {item.title}
              </span>
              {(item.turn?.note || item.mention?.body) && (
                <span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-[11px] leading-5 text-ink-subtle">
                  {item.turn?.note ?? item.mention?.body}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </section>
  );
}

type TargetValue = string; // "member:<id>" | "agent:<id>" | "none"

function targetOf(turn: ClientTurn | null | undefined): TargetValue {
  if (!turn) return 'none';
  return `${turn.kind}:${turn.user.id}`;
}

export function TurnEditor({
  projectId,
  taskId,
  turn,
  members,
  onChanged,
  onError,
}: {
  projectId: string | null;
  taskId: string;
  turn: ClientTurn | null | undefined;
  members: Member[];
  onChanged: (turn: ClientTurn | null) => void;
  onError: (message: string) => void;
}) {
  const [target, setTarget] = useState<TargetValue>(targetOf(turn));
  const [reason, setReason] = useState<TurnReason>(
    turn?.reason ?? 'awaiting_acceptance',
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const active = members.filter((member) => !member.pending);

  async function submit() {
    if (!projectId || saving) return;
    setSaving(true);
    try {
      const [kind, userId] = target.split(':');
      const keepsSpecificAgent =
        kind === 'agent' &&
        turn?.kind === 'agent' &&
        turn.user.id === userId &&
        turn.tokenId;
      const response = await fetch('/api/task-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          taskId,
          to:
            target === 'none'
              ? null
              : {
                  kind,
                  userId,
                  tokenId: keepsSpecificAgent ? turn.tokenId : undefined,
                },
          reason,
          note: note.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error('turn');
      const payload = (await response.json()) as { turn: ClientTurn | null };
      setNote('');
      onChanged(payload.turn);
    } catch {
      onError('交出失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="space-y-2.5 rounded-2xl border border-ink/10 bg-canvas p-3"
      aria-labelledby="task-turn-title"
    >
      <div className="flex items-center justify-between gap-2">
        <Label id="task-turn-title">轮到谁</Label>
        {turn ? (
          <span className="truncate text-[11px] text-ink-subtle">
            {turn.label} · {turn.reasonLabel} · 已等 {waitingLabel(turn.since)}
          </span>
        ) : (
          <span className="text-[11px] text-ink-faint">暂无</span>
        )}
      </div>
      {turn?.note && (
        <p className="whitespace-pre-wrap break-words rounded-xl bg-card px-3 py-2 text-[11px] leading-5 text-ink-subtle">
          {turn.note}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="交给"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="h-9 min-w-0 rounded-xl border border-ink/10 bg-card px-2 text-xs"
        >
          <option value="none">不指定</option>
          {active.map((member) => (
            <option key={`m-${member.id}`} value={`member:${member.id}`}>
              {member.name}
            </option>
          ))}
          {active.map((member) => (
            <option key={`a-${member.id}`} value={`agent:${member.id}`}>
              {member.name} 的 agent
            </option>
          ))}
        </select>
        <select
          aria-label="原因"
          value={reason}
          disabled={target === 'none'}
          onChange={(event) => setReason(event.target.value as TurnReason)}
          className="h-9 min-w-0 rounded-xl border border-ink/10 bg-card px-2 text-xs disabled:opacity-50"
        >
          {TURN_REASONS.map((value) => (
            <option key={value} value={value}>
              {TURN_REASON_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        aria-label="交接说明"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        placeholder="要对方看什么、做什么（可选）"
        className="min-h-14 resize-none rounded-xl border-ink/15 bg-card px-3 py-2 text-xs focus-visible:ring-0"
      />
      <Button
        type="button"
        size="sm"
        disabled={saving || !projectId}
        onClick={() => void submit()}
        className="w-full rounded-xl bg-ink text-background"
      >
        {saving ? <LoaderCircle className="animate-spin" /> : <Hand />}
        {target === 'none' ? '清除轮次' : '交出'}
      </Button>
    </section>
  );
}
