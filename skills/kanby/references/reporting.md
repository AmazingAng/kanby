# Team delivery review

```bash
kanby report --from 2026-09-07 --to 2026-09-13 --timezone Asia/Shanghai --json
kanby activity --limit 50 --json
kanby activity --cursor '<nextCursor>' --limit 50 --json
kanby activity --task KANBY-21 --json
```

The end date is inclusive. Timezone defaults to UTC; specify the user's IANA zone.
Activity includes human, Agent and GitHub events, including archived tasks, with
stable timestamp/id pagination. Follow `nextCursor` until null; do not infer that
an empty recent task excerpt means no work occurred. Activity records created
before unified tracking existed, permanently deleted comments, and coalesced
edit/heartbeat detail cannot be reconstructed. Activity is contextual evidence;
report metrics use an independent transactional statistical journal.

- `coverage.complete=false`: counts are only observed records. Do not report the
  observed count as total weekly output, or estimate missing rates from current
  card state or `updatedAt`. Reliable collection begins when the migration runs;
  historical dates are not backfilled from guesses.
- `period.provisional=true`: the period is ongoing or future. The report cutoff
  is the current instant; distinguish partial-period output from a final report.
- Unit: top-level task. Children do not add another unit to a parent's delivery.
- Throughput: distinct tasks entering shipped in the interval and still shipped
  at cutoff. Repeated completion is deduplicated. Reopened tasks count only after
  re-completion; the `reopened` count makes that work visible. Archive preserves
  history. Shipped means board completion, not deployment or verified acceptance.
- Planned completion rate: tasks open and active at period start with a deadline
  in the period form a fixed cohort. Numerator is those shipped by cutoff. Later
  deadline changes, archiving or deletion do not shrink the denominator. New
  mid-period tasks may add throughput but do not enter this planned cohort.
- Membership equivalents include zero-output members, weighted by time in the
  project during the observed interval. `perMemberThroughput` divides team
  throughput by these equivalents. Completion credit is split equally among the
  owners at completion; later owner changes do not rewrite attribution.
- Missing coverage or zero denominators yield null rates. Null is not zero.
- Cycle samples require an observed transition into building; baseline tasks
  already building have unknown starts. Calendar hours are not labor hours.
- Quality lists refer to task IDs at cutoff: unchecked completed cards, completed
  cards without checklists, completed parents with unfinished children, and open
  cards without deadlines. They are not automatically evidence of failed work.

Prefer changes to team flow over individual rankings. Tasks differ in size and
complexity; this model does not track effort, leave, FTE, production deployments,
or business impact. Token scope is one project, not all projects in an organization.
If the service returns `history_limit`, report that the query failed rather than
substituting a truncated sample or an ad hoc completion-event count.
