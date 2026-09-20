import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateTeamMetrics,
  metricPeriod,
  MetricInputError,
  type MetricEvent,
  type MetricState,
  type MemberEvent,
} from '@/lib/team-metrics';
const start = Date.parse('2026-09-07T00:00:00Z');
const day = 86400000;
const period = {
  from: '2026-09-07',
  to: '2026-09-13',
  timeZone: 'UTC',
  start,
  end: start + 7 * day,
};
const state: MetricState = {
  status: 'building',
  owners: ['a'],
  due: '2026-09-10',
  parentId: null,
  archived: false,
  deleted: false,
  criteria: 1,
  checked: 1,
  openChildren: 0,
};
const event = (
  sequence: number,
  taskId: string,
  at: number,
  patch: Partial<MetricState> = {},
  kind = 'change',
): MetricEvent => ({
  sequence,
  taskId,
  at,
  kind,
  state: { ...state, ...patch },
});
const members: MemberEvent[] = ['a', 'b'].map((userId, i) => ({
  sequence: i,
  userId,
  name: userId,
  at: start - day,
  active: true,
}));
const calc = (events: MetricEvent[], extra = {}) =>
  calculateTeamMetrics({
    period,
    events,
    members,
    coverageFrom: start - day,
    now: period.end,
    ...extra,
  });
describe('team delivery metrics contract', () => {
  it('uses local calendar boundaries including DST and an inclusive last day', () => {
    expect(
      metricPeriod('2026-03-08', '2026-03-08', 'America/New_York'),
    ).toMatchObject({
      start: Date.parse('2026-03-08T05:00Z'),
      end: Date.parse('2026-03-09T04:00Z'),
    });
    expect(
      metricPeriod('2026-09-07', '2026-09-13', 'Asia/Shanghai').start,
    ).toBe(Date.parse('2026-09-06T16:00Z'));
  });
  it('rejects invalid dates, reversed/oversized ranges and invalid zones', () => {
    for (const args of [
      ['2026-02-30', '2026-03-01', 'UTC'],
      ['2026-09-13', '2026-09-07', 'UTC'],
      ['2025-01-01', '2026-09-13', 'UTC'],
      ['2026-09-07', '2026-09-13', 'Bogus/Zone'],
    ])
      expect(() => metricPeriod(...(args as [string, string, string]))).toThrow(
        MetricInputError,
      );
  });
  it('deduplicates completions and freezes the due-date cohort', () => {
    const r = calc([
      event(1, 'x', start - day),
      event(2, 'y', start - day),
      event(3, 'x', start + day, { status: 'shipped' }),
      event(4, 'x', start + 2 * day, { status: 'shipped' }),
      event(5, 'y', start + day, { due: '2026-10-01' }),
      event(6, 'z', start + day, {}, 'created'),
      event(7, 'z', start + 2 * day, { status: 'shipped' }),
    ]);
    expect(r.team).toMatchObject({
      throughput: 2,
      planned: 2,
      plannedCompleted: 1,
      completionRate: 0.5,
      memberEquivalents: 2,
      perMemberThroughput: 1,
    });
  });
  it('removes reopened tasks, counts re-completion once, and excludes the end instant', () => {
    const base = [
      event(1, 'x', start - day),
      event(2, 'x', start + day, { status: 'shipped' }),
      event(3, 'x', start + 2 * day),
    ];
    expect(calc(base).team.throughput).toBe(0);
    expect(
      calc([
        ...base,
        event(4, 'x', start + 3 * day, { status: 'shipped' }),
        event(5, 'y', period.end, { status: 'shipped' }, 'created'),
      ]).team,
    ).toMatchObject({ throughput: 1, reopened: 1 });
  });
  it('preserves completion-time shared credit after reassignment and archive/delete', () => {
    const r = calc([
      event(1, 'x', start - day, { owners: ['a', 'b'] }),
      event(2, 'x', start + day, { status: 'shipped', owners: ['a', 'b'] }),
      event(3, 'x', start + 2 * day, {
        status: 'shipped',
        owners: ['c'],
        archived: true,
      }),
      event(4, 'x', start + 3 * day, {
        status: 'shipped',
        owners: ['c'],
        archived: true,
        deleted: true,
      }),
    ]);
    expect(r.team.throughput).toBe(1);
    expect(r.people.find((p) => p.id === 'a')?.completionCredit).toBe(0.5);
    expect(r.people.find((p) => p.id === 'b')?.completionCredit).toBe(0.5);
  });
  it('includes zero-output members and weights joining/leaving by period duration', () => {
    const roster = [members[0]!, { ...members[1]!, at: start + 3.5 * day }];
    const r = calc(
      [
        event(1, 'x', start - day),
        event(2, 'x', start + day, { status: 'shipped' }),
      ],
      { members: roster },
    );
    expect(r.team.memberEquivalents).toBe(1.5);
    expect(r.team.perMemberThroughput).toBeCloseTo(2 / 3);
    expect(r.people.find((p) => p.id === 'b')?.completionCredit).toBe(0);
  });
  it('excludes children and flags unchecked completion and unfinished children', () => {
    const r = calc([
      event(1, 'parent', start - day),
      event(2, 'parent', start + day, {
        status: 'shipped',
        criteria: 6,
        checked: 0,
        openChildren: 1,
      }),
      event(
        3,
        'child',
        start + day,
        { status: 'shipped', parentId: 'parent' },
        'created',
      ),
    ]);
    expect(r.team.throughput).toBe(1);
    expect(r.quality.uncheckedCompleted).toEqual(['parent']);
    expect(r.quality.completedWithOpenChildren).toEqual(['parent']);
  });
  it('returns null rates for missing historical coverage and empty denominators', () => {
    expect(
      calc([], { coverageFrom: start + day }).team.completionRate,
    ).toBeNull();
    expect(calc([], { coverageFrom: start + day }).coverage.complete).toBe(
      false,
    );
    expect(calc([]).team.completionRate).toBeNull();
    expect(calc([], { members: [] }).team.perMemberThroughput).toBeNull();
  });
  it('does not turn baseline shipped tasks into deliveries, and marks ongoing reports provisional', () => {
    expect(
      calc([event(1, 'x', start + day, { status: 'shipped' }, 'baseline')]).team
        .throughput,
    ).toBe(0);
    expect(calc([], { now: start + day }).period.provisional).toBe(true);
  });
  it('preserves total credit and permutation invariance for independent task histories', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (n) => {
        const events = Array.from({ length: n }, (_, i) => [
          event(i * 2, `t${i}`, start - day, { owners: ['a', 'b'] }),
          event(i * 2 + 1, `t${i}`, start + day, {
            status: 'shipped',
            owners: ['a', 'b'],
          }),
        ]).flat();
        const r = calc(events);
        const reverse = calc([...events].reverse());
        expect(r.team.throughput).toBe(n);
        expect(r.people.reduce((sum, p) => sum + p.completionCredit, 0)).toBe(
          n,
        );
        expect(reverse.team).toEqual(r.team);
      }),
    );
  });
  it('measures only observed work cycles, including even medians and no stale start after reopen', () => {
    const events = [
      event(1, 'a', start - day),
      event(2, 'b', start - day),
      event(3, 'a', start, { status: 'shipped' }),
      event(4, 'b', start + day, { status: 'shipped' }),
    ];
    expect(calc(events).team).toMatchObject({
      cycleSampleSize: 2,
      medianCycleHours: 36,
    });
    expect(
      calc([
        ...events,
        event(5, 'a', start + 2 * day, { status: 'ideas' }),
        event(6, 'a', start + 3 * day, { status: 'shipped' }),
      ]).team.cycleSampleSize,
    ).toBe(1);
    expect(
      calc([
        event(1, 'a', start - day, {}, 'baseline'),
        event(2, 'a', start + day, { status: 'shipped' }),
      ]).team.cycleSampleSize,
    ).toBe(0);
  });
  it('preserves the frozen denominator after unfinished tasks are archived or deleted', () => {
    expect(
      calc([
        event(1, 'x', start - day),
        event(2, 'x', start + day, { archived: true, deleted: true }),
      ]).team,
    ).toMatchObject({ planned: 1, plannedCompleted: 0, completionRate: 0 });
  });
  it('tracks membership exits and re-entry without double counting and omits departed pre-period members', () => {
    const roster = [
      members[0]!,
      { ...members[0]!, sequence: 10, at: start + day, active: false },
      { ...members[0]!, sequence: 11, at: start + 3 * day },
      { ...members[0]!, sequence: 12, at: start + 4 * day },
      members[1]!,
      { ...members[1]!, sequence: 13, at: start - 1, active: false },
    ];
    const r = calc([], { members: roster });
    expect(r.team.memberEquivalents).toBeCloseTo(5 / 7);
    expect(r.people).toHaveLength(1);
    expect(
      calc([
        event(
          1,
          'unlisted',
          start,
          { owners: ['c'], status: 'shipped' },
          'created',
        ),
      ]).people.find((p) => p.id === 'c'),
    ).toMatchObject({ completionCredit: 1, memberEquivalent: 0 });
  });
  it('reports undated work and absent checklists without confusing empty lists with passed acceptance', () => {
    const r = calc([
      event(1, 'x', start, { due: null }),
      event(
        2,
        'y',
        start,
        { criteria: 0, checked: 0, status: 'shipped' },
        'created',
      ),
      event(3, 'archived', start, { due: null, archived: true }),
    ]);
    expect(r.quality.openWithoutDeadline).toEqual(['x']);
    expect(r.quality.completedWithoutChecklist).toEqual(['y']);
  });
  it('handles autumn DST, exact period boundaries, leap days and nonexistent local dates', () => {
    const fall = metricPeriod('2026-11-01', '2026-11-01', 'America/New_York');
    expect(fall.end - fall.start).toBe(25 * 3600000);
    expect(
      metricPeriod('2024-02-29', '2024-02-29').end -
        metricPeriod('2024-02-29', '2024-02-29').start,
    ).toBe(day);
    expect(() =>
      metricPeriod('2011-12-30', '2011-12-30', 'Pacific/Apia'),
    ).toThrow(MetricInputError);
    for (const date of ['1999-12-31', '2101-01-01', 'garbage'])
      expect(() => metricPeriod(date, date)).toThrow(MetricInputError);
    expect(
      calc([
        event(1, 'opening', start, { status: 'shipped' }, 'created'),
        event(2, 'end', period.end, { status: 'shipped' }, 'created'),
      ]).team.throughput,
    ).toBe(1);
  });
  it('allows a valid day immediately before a skipped local day, but rejects a skipped end date', () => {
    const range = metricPeriod('2011-12-29', '2011-12-29', 'Pacific/Apia');
    expect(range.end - range.start).toBe(day);
    expect(() =>
      metricPeriod('2011-12-29', '2011-12-30', 'Pacific/Apia'),
    ).toThrow(MetricInputError);
  });
});
