export type MetricState = {
  status: 'ideas' | 'building' | 'shipped';
  owners: string[];
  due: string | null;
  parentId: string | null;
  archived: boolean;
  deleted: boolean;
  criteria: number;
  checked: number;
  openChildren: number;
};
export type MetricEvent = {
  sequence: number;
  taskId: string;
  at: number;
  kind: string;
  state: MetricState;
};
export type MemberEvent = {
  sequence: number;
  userId: string;
  name: string;
  at: number;
  active: boolean;
};
export type MetricPeriod = {
  from: string;
  to: string;
  timeZone: string;
  start: number;
  end: number;
};

const DAY = 86_400_000;
export class MetricInputError extends Error {}
function calendarDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2000-01-01' ||
    value > '2100-12-31'
  )
    throw new MetricInputError(
      'Dates must be valid YYYY-MM-DD between 2000 and 2100',
    );
  const date = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== value
  )
    throw new MetricInputError('Invalid calendar date');
  return date;
}
function zonedDayStart(
  value: string,
  format: Intl.DateTimeFormat,
  requireDay = true,
) {
  const utc = Date.parse(`${value}T00:00:00Z`);
  const localDate = (at: number) => {
    const parts = format.formatToParts(at);
    const part = (name: string) => parts.find((p) => p.type === name)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  // First second belonging to the requested local day, including 23/25 hour days.
  let low = (utc - 36 * 3_600_000) / 1000,
    high = (utc + 36 * 3_600_000) / 1000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDate(mid * 1000) < value) low = mid + 1;
    else high = mid;
  }
  if (requireDay && localDate(low * 1000) !== value)
    throw new MetricInputError('Calendar day does not exist in this timezone');
  return low * 1000;
}
export function metricPeriod(
  from: string,
  to: string,
  timeZone = 'UTC',
): MetricPeriod {
  const first = calendarDate(from),
    last = calendarDate(to);
  if (last < first || last - first >= 366 * DAY)
    throw new MetricInputError('Range must contain 1 to 366 calendar days');
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new MetricInputError('Invalid IANA timezone');
  }
  zonedDayStart(to, format);
  const next = new Date(last + DAY).toISOString().slice(0, 10);
  return {
    from,
    to,
    timeZone,
    start: zonedDayStart(from, format),
    end: zonedDayStart(next, format, false),
  };
}

type Person = {
  id: string;
  name: string;
  memberEquivalent: number;
  completionCredit: number;
};
function rosterAtPeriod(members: MemberEvent[], start: number, end: number) {
  const people = new Map<string, Person>();
  const joined = new Map<string, number>();
  const duration = Math.max(0, end - start);
  for (const e of [...members].sort(
    (a, b) => a.at - b.at || a.sequence - b.sequence,
  )) {
    if (e.at >= end) continue;
    const person = people.get(e.userId) ?? {
      id: e.userId,
      name: e.name,
      memberEquivalent: 0,
      completionCredit: 0,
    };
    people.set(e.userId, person);
    person.name = e.name;
    if (e.active) {
      if (!joined.has(e.userId)) joined.set(e.userId, Math.max(start, e.at));
    } else {
      const since = joined.get(e.userId);
      if (since !== undefined) {
        person.memberEquivalent += Math.max(0, e.at - since) / (duration || 1);
        joined.delete(e.userId);
      }
    }
  }
  for (const [id, since] of joined)
    people.get(id)!.memberEquivalent +=
      Math.max(0, end - since) / (duration || 1);
  return people;
}

export function calculateTeamMetrics(input: {
  period: MetricPeriod;
  events: MetricEvent[];
  members: MemberEvent[];
  coverageFrom: number;
  now: number;
}) {
  const { period } = input;
  const cutoff = Math.min(period.end, input.now);
  const complete = input.coverageFrom <= period.start && cutoff > period.start;
  const opening = new Map<string, MetricState>(),
    closing = new Map<string, MetricState>();
  const completed = new Map<string, MetricEvent>(),
    reopened = new Set<string>();
  const started = new Map<string, number>();
  const cycles = new Map<string, number>();
  const events = [...input.events].sort(
    (a, b) => a.at - b.at || a.sequence - b.sequence,
  );
  for (const e of events) {
    if (e.at >= cutoff) continue;
    const prev = closing.get(e.taskId);
    closing.set(e.taskId, e.state);
    if (e.at < period.start) opening.set(e.taskId, e.state);
    if (e.kind === 'baseline') continue;
    if (e.state.status === 'building' && prev?.status !== 'building')
      started.set(e.taskId, e.at);
    const inPeriod = e.at >= period.start;
    if (e.state.status !== 'shipped' && prev?.status === 'shipped') {
      completed.delete(e.taskId);
      cycles.delete(e.taskId);
      if (inPeriod && !e.state.parentId) reopened.add(e.taskId);
    }
    if (
      e.state.status === 'shipped' &&
      prev?.status !== 'shipped' &&
      !e.state.deleted &&
      !e.state.parentId &&
      inPeriod
    ) {
      completed.set(e.taskId, e);
      const since = started.get(e.taskId);
      if (since !== undefined) cycles.set(e.taskId, e.at - since);
    }
    if (e.state.status === 'shipped') started.delete(e.taskId);
  }
  const cohort = [...opening]
    .filter(
      ([, s]) =>
        !s.parentId &&
        !s.archived &&
        !s.deleted &&
        s.status !== 'shipped' &&
        s.due &&
        s.due >= period.from &&
        s.due <= period.to,
    )
    .map(([id]) => id);
  const delivered = [...completed.values()].filter(
    (e) => closing.get(e.taskId)?.status === 'shipped',
  );
  const plannedCompleted = cohort.filter(
    (id) => closing.get(id)?.status === 'shipped',
  ).length;
  const people = rosterAtPeriod(input.members, period.start, cutoff);
  for (const e of delivered) {
    const owners = [...new Set(e.state.owners)];
    for (const id of owners) {
      const person = people.get(id) ?? {
        id,
        name: id,
        memberEquivalent: 0,
        completionCredit: 0,
      };
      person.completionCredit += 1 / owners.length;
      people.set(id, person);
    }
  }
  const equivalents = [...people.values()].reduce(
    (sum, p) => sum + p.memberEquivalent,
    0,
  );
  const cycleValues = delivered
    .flatMap((e) => (cycles.has(e.taskId) ? [cycles.get(e.taskId)!] : []))
    .sort((a, b) => a - b);
  const middle = Math.floor(cycleValues.length / 2);
  const median = cycleValues.length
    ? (cycleValues[middle]! +
        cycleValues[Math.floor((cycleValues.length - 1) / 2)]!) /
      2
    : null;
  const topLevel = [...closing].filter(([, s]) => !s.parentId && !s.deleted);
  return {
    period: { ...period, cutoff, provisional: input.now < period.end },
    coverage: {
      from: input.coverageFrom,
      complete,
      reason: complete
        ? null
        : 'History does not cover the full observed period; counts are observations, rates are unavailable.',
    },
    unit: 'top-level task',
    definitions: {
      completionRate:
        'Tasks open at period start, due within the period, and shipped at cutoff / all such planned tasks. Cohort is frozen at start.',
      throughput:
        'Distinct top-level tasks entering shipped during the period and still shipped at cutoff; not deployments.',
      perMemberThroughput:
        'Throughput / membership duration in period equivalents, including zero-output members. Shared task credit is split equally at completion. Not a productivity ranking.',
    },
    team: {
      throughput: delivered.length,
      planned: cohort.length,
      plannedCompleted,
      completionRate:
        complete && cohort.length ? plannedCompleted / cohort.length : null,
      memberEquivalents: equivalents,
      perMemberThroughput:
        complete && equivalents > 0 ? delivered.length / equivalents : null,
      reopened: reopened.size,
      medianCycleHours: median === null ? null : median / 3_600_000,
      cycleSampleSize: cycleValues.length,
    },
    people: [...people.values()]
      .filter((p) => p.memberEquivalent > 0 || p.completionCredit > 0)
      .sort((a, b) => a.id.localeCompare(b.id)),
    quality: {
      uncheckedCompleted: topLevel
        .filter(([, s]) => s.status === 'shipped' && s.checked < s.criteria)
        .map(([id]) => id),
      completedWithoutChecklist: topLevel
        .filter(([, s]) => s.status === 'shipped' && s.criteria === 0)
        .map(([id]) => id),
      completedWithOpenChildren: topLevel
        .filter(([, s]) => s.status === 'shipped' && s.openChildren > 0)
        .map(([id]) => id),
      openWithoutDeadline: topLevel
        .filter(([, s]) => !s.archived && s.status !== 'shipped' && !s.due)
        .map(([id]) => id),
    },
    tasks: {
      planned: cohort,
      completed: delivered.map((e) => ({
        id: e.taskId,
        completedAt: e.at,
        owners: e.state.owners,
      })),
      reopened: [...reopened],
    },
  };
}
export type TeamMetrics = ReturnType<typeof calculateTeamMetrics>;
