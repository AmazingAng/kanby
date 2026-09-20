# Kanby Agent API

The v1 API uses a project-scoped Agent Token:

```http
Authorization: Bearer kby_...
```

Every current project member can create Agent Tokens in Settings. A member sees and
revokes only their own tokens, while the project owner can administer every token in
the project. Kanby labels each token as `<github-login>_<token-name>` using the
authenticated GitHub identity, so clients cannot spoof the owner shown in the UI.

Each member can have at most 10 active, unexpired tokens in a project. Kanby stores
only the SHA-256 digest and displays the plaintext token once, immediately after
creation. Removing a member from the project immediately invalidates that member's
tokens.

## Endpoints

- `GET /api/v1/projects` — return the token's project.
- `GET /api/v1/tasks?status=ideas` — list tasks.
- `GET /api/v1/tasks?id=<ref>` — task detail, current claim, and agent activity.
- `POST /api/v1/tasks` — create a task with `title`, optional `status`, `note`, and `due`. `due` is an optional `YYYY-MM-DD` calendar date stored with the initial task insert; omit it or pass an empty string for no deadline. Invalid dates, datetime strings, and non-string values return HTTP 400 `invalid_due` before a task is created.
- `PATCH /api/v1/tasks` — mutate a task with `action`: `update`, `split`, `claim`, `heartbeat`, `progress`, `release`, `link`, or `complete`. An `update` may send ordered `ownerIds` with 1–3 current project-member IDs; legacy `ownerId` remains supported. `split` accepts `titles` with 1–20 child titles and is idempotent when the request supplies an `Idempotency-Key`.

Task JSON includes ordered `owners` for every assignee and retains `owner` as the first assignee for compatibility. Human-readable CLI task output lists every assignee login.

Task reads include an ordered `acceptanceCriteria` array. Each item contains
`id`, `body`, `completed`, `position`, `createdAt`, and `updatedAt`. The CLI
renders it as a Markdown-style `[ ]` / `[x]` checklist in `task get`; JSON mode
preserves the structured array.

Checklist mutations use `PATCH /api/v1/tasks` with `id` and `action`:
`checklist.add` takes `body`; `checklist.edit` takes `criterionId` and `body`;
`checklist.check`, `checklist.uncheck`, and `checklist.remove` take `criterionId`.
Read the current items, verify the criterion, check its ID, and re-read before
sending `complete`. Completion sets the status to `shipped` and records its
message; it does not check items automatically or enforce that all are checked.
Agents must perform that verification workflow explicitly.

Every successful Agent mutation is also written to the task's unified activity timeline. Repeated heartbeats for the same claim are coalesced, while progress messages remain visible to teammates and power the compact “Agent 正在处理” state on the board card. Releasing or completing a task clears the live card state; its history remains in the timeline.

When an Agent creates a Pull Request, it should add `Kanby-Task: <task ref>` as a standalone trailer in the PR body or use a `kanby/<task ref>-description` branch. If the project's PR auto-link rule is enabled, the verified GitHub webhook associates that PR with the active task. The explicit `link` action remains available as a fallback.

For retryable mutations, send a stable `Idempotency-Key` header between 8 and 128 characters. A claim is a renewable 1–60 minute lease. GitHub links are accepted only for repositories selected in the corresponding Kanby project.

Successful responses use `{ "ok": true, "data": ... }`. Errors use `{ "ok": false, "error": { "code": "...", "message": "..." } }`.

## Delivery reports and full activity pagination

- `GET /api/v1/metrics?from=2026-09-07&to=2026-09-13&timezone=Asia%2FShanghai`
  requires `task:read`, uses only the token's project, and returns `{ok,data}`.
  Dates are inclusive local dates (2000–2100), at most 366 days; timezone defaults
  to UTC. Invalid periods return 400. Histories over 50,000 combined task/member
  records return 422 `history_limit`, never partial success. All responses disable caching.
- `GET /api/v1/activity?task=KANBY-21&limit=50&cursor=<nextCursor>` requires
  `task:read`. `task` is optional; omit it for all project activity. Follow
  `data.nextCursor` until null. Archived task references are supported. Events
  include human, Agent, system and GitHub sources. Existing `task get` stays compatible.
- Browser `GET /api/metrics` accepts the same period plus `projectId`, authorized
  by current session membership. A supplied project ID cannot widen Agent scope.

Metric definitions and interpretation limits are maintained in
[the reporting reference](../skills/kanby/references/reporting.md).

Migration `0015_team_metrics.sql` establishes a collection baseline and compact
statistical journal. Existing tasks are snapshots, not invented historical
completions. The journal is independent of mutable/coalesced activity messages.
Project mutation transactions update `projects.updated_at` after task/assignee/
checklist writes, and the database trigger snapshots changed statistical state
at that point. New tasks and membership transitions have dedicated triggers.
Task position, title, description and heartbeat updates produce no statistical
change. Task deletion retains a statistical tombstone (IDs, owners and task
state, without task text), so deleting a card does not rewrite historical totals.
Future database writers must keep the same transaction ordering; raw maintenance
SQL that bypasses the project commit marker is outside this collection contract.
