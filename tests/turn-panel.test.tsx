import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  TurnChip,
  TurnQueue,
  waitingLabel,
  type ClientTurn,
} from '@/components/turn-panel';

const now = Date.now();
const turn: ClientTurn = {
  kind: 'agent',
  user: { id: 'user-2', login: 'bob', name: 'Bob', avatarUrl: null },
  tokenId: null,
  agentName: 'claude',
  label: 'Bob 的 claude',
  reason: 'awaiting_review',
  reasonLabel: '待复核',
  note: '复核迁移',
  since: now - 3 * 24 * 3_600_000,
};

describe('turn panel', () => {
  it('labels waiting time in minutes, hours and days', () => {
    expect(waitingLabel(now - 5 * 60_000, now)).toBe('5 分钟');
    expect(waitingLabel(now - 5 * 3_600_000, now)).toBe('5 小时');
    expect(waitingLabel(now - 3 * 24 * 3_600_000, now)).toBe('3 天');
  });

  it('shows whose turn a card is', () => {
    const html = renderToStaticMarkup(<TurnChip turn={turn} />);
    expect(html).toContain('轮到 Bob 的 claude · 待复核');
    expect(html).toContain('3 天');
  });

  it('renders my turns and mentions, and an empty state', () => {
    const html = renderToStaticMarkup(
      <TurnQueue
        currentUserId="user-1"
        onOpen={() => undefined}
        items={[
          {
            type: 'turn',
            taskId: 't1',
            ref: 'KANBY-3',
            title: '验收登录',
            status: 'building',
            since: now - 60_000,
            turn: {
              ...turn,
              kind: 'member',
              user: { ...turn.user, id: 'user-1' },
              label: 'Alice',
              reason: 'awaiting_acceptance',
              reasonLabel: '待验收',
            },
            mention: null,
          },
          {
            type: 'mention',
            taskId: 't2',
            ref: 'KANBY-4',
            title: '导出格式',
            status: 'building',
            since: now - 120_000,
            turn: null,
            mention: {
              id: 'm1',
              targetKind: 'member',
              by: 'Bob 的 claude',
              body: '@alice 选 A 还是 B？',
            },
          },
        ]}
      />,
    );
    expect(html).toContain('轮到你 · 待验收');
    expect(html).toContain('Bob 的 claude @ 了你');
    expect(html).toContain('选 A 还是 B');
    expect(
      renderToStaticMarkup(
        <TurnQueue items={[]} currentUserId={null} onOpen={() => undefined} />,
      ),
    ).toContain('现在没有在等你的卡');
  });
});
