# Team delivery metrics — implementation evidence

Contract: [TEAM_METRICS_SPEC.md](TEAM_METRICS_SPEC.md).

Spec approval: not obtained (autonomous run). No independent verifier was used.
The task was implemented and adversarially tested by the same agent; these checks
provide bounded evidence, not an independently approved specification.

## Result

The project board has a date/timezone delivery report. CLI 0.4.0 adds `report` and
paginated `activity`. Browser and Agent reads share a single calculation model and
respect current membership / the token's project and read scope.

Migration 0015 records existing state as a baseline, then transactionally collects
statistical task snapshots and membership changes. It does not backdate history.
The journal omits task titles, notes and comments; compact statistical history
survives permanent card deletion. Existing task/Agent APIs remain compatible.

## Acceptance mapping

| Spec                                               | Executable evidence                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Transactional history, no reorder noise            | `tests/team-metrics-store.test.ts`: final assignees captured atomically; rollback and stale-save tests; Agent/browser/GitHub paths |
| Baseline and incomplete coverage                   | Existing-database migration test; baseline is not a completion; missing coverage returns null rates                                |
| Inclusive local dates and DST                      | Spring and autumn New York transitions, Shanghai boundary, leap dates, Samoa skipped day and invalid ranges                        |
| Top-level units and hierarchy                      | Child exclusion, unfinished-child quality warning, split and parent deletion integration                                           |
| Deduplication and reopening                        | Repeated completion, reopen/re-complete, exclusive period end, Agent idempotency                                                   |
| Frozen planned denominator                         | Deadline change and mid-period addition test; unfinished archive/delete keeps denominator                                          |
| Attribution and member denominator                 | Shared credit after reassignment; zero-output members, joining, leaving and re-entry; property test preserves total credit         |
| Acceptance and cycle evidence                      | Checklist/no-checklist quality, missing deadlines, observed cycle medians and unknown baseline starts                              |
| Authorized report and complete activity pagination | Token project scoping, browser membership, read-scope enforcement, archived activity across 55 tied-timestamp events               |
| CLI and visible browser behavior                   | Actual CLI HTTP subprocess tests plus local Worker/D1 and Chromium execution described below                                       |

## Validation results

`npm run gauntlet`: **14/14 layers passed** on the final implementation.

- Full suite: **31 files, 202 tests passed**.
- Full-suite configured coverage passed its 90% line/function/statement and 85%
  branch thresholds. The separate `npm run test:metrics` gate passed **27 tests**,
  with **163/163 lines (100%)**, **176/177 statements (99.43%)**, **35/35 functions
  (100%)**, and **150/158 branches (94.93%)** in the new report calculation,
  storage, response and route modules. It enforces 100/95/100/90 respectively.
  Browser component coverage is not included in that claim.
- `npx tsc --noEmit`, `npm run lint`, format check and `git diff --check` passed.
- Mutation gate: **78/78 killed**, including eight new mutations for period end,
  denominator, shared credit, baseline, incomplete coverage, no-op journal writes
  Agent read scope and project isolation. The existing manual mutation runner now rejects abnormal
  subprocess termination; these are selected mutations, not exhaustive AST coverage.
- Property checks exercise independent-history ordering and equal-credit
  conservation across 1–50 tasks.
- Randomized suite order, seed 9082026: **202 passed**.
- Production dependency audit: **0 vulnerabilities**. No dependency was added.
- Secret scanner passed, including its negative control and reachable Git history.
- CLI unauthenticated contract and package contents checks passed.
- Worker production build and recovery schedule verification passed.
- `quick_validate.py skills/kanby`: **Skill is valid**.

RED observations: the first calculation stub failed 9 behavioral tests; the initial
invalid-input test was strengthened to require `MetricInputError`. A later
adversarial test exposed rejection of a valid day immediately before Samoa's
skipped day; that test failed before the date-boundary fix and now passes.

## Actual runtime checks

All 16 migrations, including 0015's JSON view and database triggers, applied to a
fresh **local** Wrangler D1 database. A synthetic two-member fixture was tested
through the built Worker and the actual CLI, without production credentials:

- Four tasks planned at period start, two delivered: **50%** completion.
- Two member equivalents: **1.00** delivery per member equivalent.
- Shared assignment: Alice **0.50**, Bob **1.50** completion credit.

Headless Chromium opened the project board, opened the report, and checked those
values at 1440px and 390px viewport widths. There were no page JavaScript errors or
horizontal dialog overflow. Invalid timezone feedback, incomplete-history null
rates and scrolling to the quality section were also exercised. Local screenshots
were inspected at `outputs/team-metrics-desktop.png` and
`outputs/team-metrics-mobile.png` (ignored artifacts, not repository dependencies).

The isolated checkout installed the locked dependencies with `npm ci --ignore-scripts`.
It did not copy the user's `.env` files or use the production database. The local
Worker was stopped after verification. No production migration, deployment or npm
publication was performed.

## Practical limits

- History before migration remains incomplete; deleted historical activity cannot
  be recovered. Existing `task get` still contains its compatible recent excerpt;
  the new activity command paginates available unified events.
- The task unit deliberately excludes children. Counts do not estimate effort,
  difficulty, leave/FTE or business impact. Board completion is not deployment.
- Membership equivalents measure calendar membership during the observed period;
  incomplete and zero-denominator rates are null. Ongoing reports are provisional.
- Runtime task mutation transactions update `projects.updated_at` after task,
  assignee and checklist writes. The snapshot trigger relies on that existing
  ordering. Maintenance SQL bypassing this marker is outside the collection
  contract. Project snapshots scan the project's current tasks; very large boards
  would benefit from incremental collection.
- The report refuses histories above 50,000 combined records rather than returning
  a truncated result. Historical storage is not yet partitioned or compacted.
- This report is project-scoped. Cross-project organization aggregation and
  explicit planning/effort/deployment models are future work.
- Independent verification: not performed. UI runtime checks are local smoke
  checks, not a comprehensive browser regression suite.
