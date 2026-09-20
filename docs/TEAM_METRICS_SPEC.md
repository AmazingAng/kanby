# Reliable team delivery metrics

Spec approval: not obtained (autonomous run). The user authorized implementation,
verification, commit, merge and push; no independent specification approval is claimed.

## Contract

1. Capture compact task state and membership history transactionally, independently
   of mutable activity summaries and `updated_at`. Browser, Agent and GitHub writes
   share the journal. Reorders, comments and repeated completion do not add deliveries.
2. Record a collection baseline at migration. Never fabricate older transitions;
   periods starting before coverage return incomplete coverage and null rates.
3. Query inclusive local calendar dates with an explicit IANA timezone (UTC default).
   Internally use [start, end) instants, supporting DST. Reject invalid/reversed
   ranges, unknown zones and ranges longer than 366 calendar days. Future/in-progress
   periods are marked provisional and computed only through the report timestamp.
4. Default unit is top-level task; exclude children from totals to avoid parent/child
   double counting. A completed parent with unfinished children is flagged.
5. Throughput counts distinct tasks entering shipped in the period and still shipped
   at the cutoff. Repeated complete counts once; reopening removes it until re-completed.
   Archive preserves delivery history. Permanent deletion retains compact statistical
   history, without task title, description or comments, and never counts as completion.
6. Planned completion rate: cohort frozen at start = active, non-shipped top-level
   tasks with a due date within the requested period. Numerator = that cohort shipped
   at cutoff. Denominator zero or incomplete coverage => null, never 0% or 100% by fiat.
   Later deadline edits, newly added tasks and archive/delete do not shrink the cohort.
7. Freeze assignment credit at completion, divided equally among assignees. Membership
   history supplies member-period equivalents (sum of membership durations / elapsed
   period duration), including zero-output members. Team per-person throughput divides
   by that denominator. Label this task throughput, not labor productivity or ranking;
   task size, hours and production deployments are not inferred.
8. Report checklist gaps, missing due dates, reopened tasks and history coverage.
   Board completion is not proof of deployment or independent acceptance.
9. Provide project-authorized browser and Agent read APIs, a CLI report command, and
   a browser date-range report with metric definitions. Add paginated unified activity
   to CLI/API so reviews are no longer restricted to the latest 20 Agent messages.
10. Tests cover boundary dates/DST, frozen denominators, reopen/re-complete, no-op
    reorder, owner transfer/shared credit, membership join/leave, archive/delete,
    hierarchy, incomplete baseline, pagination and cross-project authorization.

## Setup and delivery

Worktree: /tmp/kanby-team-metrics, branch codex/team-metrics. No new runtime or test
packages. Use existing npm lockfile and toolchain. Expected areas: migration and
schema under drizzle/ and db/; lib/team-metrics*.ts; app/api/{metrics,v1/metrics,
v1/activity}; components/team-metrics.tsx and board integration; packages/cli;
skills/kanby; tests/team-metrics*.test.ts and CLI/activity regressions.

Evidence: docs/TEAM_METRICS_EVIDENCE.md. Run existing full gauntlet, add targeted
coverage/property/mutation checks, exercise the CLI against a local HTTP service,
and record unavailable layers accurately. Fetch remote main, merge only this task,
rerun affected checks if upstream changed, push without force, and report remote CI.
