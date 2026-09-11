# GitHub automation P2 reliability evidence

Date: 2026-09-11 (Asia/Shanghai)

Specification: `docs/reliability/github-automation-p2-spec.md`

Human spec approval was not obtained; implementation proceeded autonomously from the user's explicit feature and acceptance request. Work remained on the existing isolated feature branch because the active application state includes untracked/modified files that a fresh worktree would omit.

## Implemented contract

- Signed webhook payloads are inserted into `github_deliveries` before automation runs.
- Failed work retains its signed payload, bounded error, attempt count, next retry time, and an expiring processing lease.
- A ten-minute Worker cron retries due inbox rows and queries recent GitHub App deliveries for failures that GitHub can redeliver.
- Delivery GUIDs, issue import uniqueness, task link keys, activity dedupe keys, and stable history event ids prevent repeated observable records.
- A project-local `task_number` supports `KANBY-123` in branches, PR title/body, PR commit messages, push commit messages, the card UI, task detail UI, and the Agent API/CLI reference resolver.
- Project settings exposes installation health, pending retry count, recent failure information, manual recovery, and bounded history backfill.
- Backfill reads only project-selected repositories with installation tokens, including private repositories.
- CI failures remain status-neutral and are highlighted on cards and timeline entries.

## Automated evidence

Final command: `npm run gauntlet`

Result: `GAUNTLET PASS: 12/12 layers`

- Unit/integration/property/concurrency: 23 files, 119 tests passed.
- Changed-code coverage: 91.54% statements, 87.22% branches, 98.43% functions, 95% lines.
- TypeScript: passed.
- Lint and formatting: passed.
- Mutation testing: 38/38 mutants killed.
- Production dependency audit: zero vulnerabilities at the configured high threshold.
- Secret scan: 222 files passed and the negative control was detected.
- CLI unauthenticated exit contract: passed.
- Randomized suite order with seed `9082026`: 119 tests passed.
- Vinext production Worker build: passed.
- Generated Worker scheduled-handler and `*/10 * * * *` cron checks: passed.

## Production evidence

- D1 migration `0014_github_reliability.sql` applied successfully: 19 statements.
- Remote D1 validation: all 39 existing tasks have a task number and all 39 project/number pairs are distinct.
- Remote D1 validation found `github_deliveries`, `github_sync_runs`, and `github_redelivery_attempts`.
- Worker deployment succeeded with D1, R2, static assets, and the recovery cron.
- Worker version: `2ec258c1-a28f-44e8-8f26-ddefb505bcb3`.
- Public demo smoke test: HTTP 200.
- Recovery endpoint without a session: HTTP 403.
- Webhook with an invalid signature: HTTP 401.

## Guarantee boundary

If a signed event reaches the D1 inbox, it remains retryable until successful and replay is idempotent. If Kanby is unavailable before persistence, the cron asks GitHub to redeliver failures during GitHub's retained App-delivery window. GitHub currently documents API/manual redelivery for the last three days, so outages beyond that window require history backfill and cannot carry a literal no-loss guarantee for event types absent from repository history.
