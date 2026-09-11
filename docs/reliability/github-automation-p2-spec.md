# GitHub automation P2 reliability specification

Status: implementation-approved autonomously for this task; explicit human spec approval was not obtained.

Risk tier: Tier 3. This change handles authenticated webhooks, retry/concurrency, durable state, and externally sourced automation.

## Goal

Make GitHub automation recoverable and idempotent. A valid GitHub event must be applied at most once, and—when either the signed payload reached Kanby or GitHub still retains a failed delivery—eventually applied after Kanby recovers.

## User-visible behaviour

- Owners can import an Issue from the GitHub activity feed without producing a duplicate task.
- Tasks have a stable, project-local key such as `KANBY-123`.
- A pull request is linked when its branch, body, title, or included commit message contains a bounded `KANBY-123` marker. Existing `Kanby-Task: <uuid>` and `kanby/<uuid>` references remain supported.
- Project owners can configure Issue creation, PR linking, PR-open status, completion status, and CI visibility independently for each project.
- Settings shows GitHub App installation health, the retry backlog, recent failures, and the last history sync. Owners can run recovery or a bounded history sync manually.
- Failed CI is visually highlighted on both the task card and the activity timeline and never changes task status by itself.

## Persistence and processing contract

1. Verify the HMAC and payload size before persistence.
2. Insert the delivery GUID and raw payload into a durable inbox before applying automation.
3. Claim a delivery atomically. Concurrent webhook, scheduled retry, and manual recovery workers cannot process the same claim simultaneously.
4. On success, mark the GUID complete and discard the raw payload. On failure, retain an error summary, increment the attempt count, and set bounded exponential backoff.
5. A repeated GUID is acknowledged without creating duplicate GitHub events, task links, imports, state transitions, or timeline entries.
6. A scheduled recovery pass retries due local inbox entries and asks GitHub to redeliver recent failed App deliveries. GitHub-side recovery is deduplicated per delivery id.
7. Terminal delivery metadata is retained for diagnosis; payloads are removed after success and stale records are pruned.

## History sync contract

- Sync only repositories selected for the project.
- Fetch a bounded recent window of Issues, pull requests, and commits.
- Use stable synthetic event/dedupe keys so re-running sync is safe.
- Apply the same project automation settings and task-reference parser as live webhooks.
- Record start, finish, item counts, and a bounded error message for diagnosis.

## Failure scenarios

- D1 unavailable before inbox insertion: return a failure so GitHub records a failed delivery; the scheduled GitHub-delivery recovery redelivers it within GitHub's retention window.
- Worker fails after inbox insertion: the local scheduled retry replays the stored payload.
- Duplicate delivery, redelivery, or overlapping history sync: idempotency keys produce one observable result.
- Worker fails after applying a side effect but before completing the inbox row: task/event/link writes remain idempotent when replayed.
- Concurrent webhook and cron recovery: only one lease holder processes the row; an expired lease can be reclaimed.
- Invalid signature, unsupported event, malformed JSON, or oversized payload: reject or safely acknowledge without applying automation; never persist untrusted oversized content.
- Suspended, deleted, inaccessible, or misconfigured GitHub App installation: settings reports a specific unhealthy state without exposing credentials.
- CI failure: creates a deduplicated red timeline event and card warning, but no task status transition.
- Ambiguous task key: resolve only inside projects connected to that repository; never link across an unrelated project.

## Security and limits

- Never log or return App private keys, webhook secrets, installation tokens, or raw webhook payloads.
- Store only signed payloads, cap payload size, cap retries per pass, bound API pagination, and bound stored error text.
- The no-loss guarantee depends on scheduled recovery running while GitHub retains failed App deliveries (currently three days), or on the payload having reached the Kanby inbox.

## Verification

- Unit/property tests cover marker boundaries, legacy references, status rules, CI behaviour, retry backoff, duplicate GUIDs, atomic claims, and history dedupe.
- Route tests cover signature rejection, durable failure recording, duplicate acknowledgement, diagnostics authorization, and recovery authorization.
- Migration tests apply every migration in order and verify task keys and inbox columns/indexes.
- Build verification asserts that the generated Worker exports a scheduled handler and contains the recovery cron.
- The final gauntlet runs formatting, lint, types/build, unit tests, coverage gates, mutation tests, migration checks, secret scanning, and bundle checks.

## Working-copy isolation

Implementation remains on the existing `codex/fix-kanby-reliability` feature branch. A separate worktree is intentionally not created because the current Kanby implementation is present as untracked/modified files and would not exist in a new worktree. Existing unrelated changes are preserved and no checkpoint commit is made without an approved specification.
