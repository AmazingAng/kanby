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
- `GET /api/v1/tasks?id=<ref>` — task detail, current claim, recent agent updates, `turn` (whose turn it is: a member or a member's agent, `reason`, `note`, `since`), `thread` (the 30 most recent conversation entries: comments, handoffs, progress, acceptance) and `unread` (conversation entries written by others after this token's read cursor, oldest first, `unreadLimit` 1–50, default 20). The cursor is a stable `(createdAt, eventId)` position and advances only to the newest entry actually returned, so read again while `unreadHasMore` is true. Add `&markRead=0` to peek and page with `&after=<unreadNextCursor>`; page older thread entries with `&threadCursor=<threadNextCursor>` (`threadLimit` 1–50, default 30).
- `GET /api/v1/next` — the agent's queue: `turns` (cards whose turn is this token, any agent of its member, or the member personally) and `mentions` (open @mentions of the member or its agents), oldest first, each with `waitingMs` and `unreadCount`. Read-only.
- `POST /api/v1/tasks` — create a task with `title`, optional `status`, `note`, and `due`. `due` is an optional `YYYY-MM-DD` calendar date stored with the initial task insert; omit it or pass an empty string for no deadline. Invalid dates, datetime strings, and non-string values return HTTP 400 `invalid_due` before a task is created.
- `PATCH /api/v1/tasks` — mutate a task with `action`: `update`, `split`, `claim`, `heartbeat`, `progress`, `comment`, `handoff`, `release`, `link`, or `complete`. `comment` takes `body` (≤2000 characters); `@login` and `@login/agent` (or `@login/<agent name>`) mentions of project members create an open mention and a notification. `handoff` takes `to` (`@login`, `@login/agent`, `@login/<agent name>`, `owner`, `self`, or `none`), `reason` (`developing`, `awaiting_acceptance`, `awaiting_decision`, `blocked`, `awaiting_review`), optional `note` (≤500) and `release` (default `true`: also release this token's claim). Handing a card that awaits acceptance back with `developing` or `blocked` is recorded as `turn.rejected`. Claims guard code work only: `update`, `split`, `link`, `complete`, `archive` and `checklist.*` return `409 claimed_by_another_agent` while another token holds the claim; `progress`, `comment`, `handoff` and attachment uploads do not. An `update` may send ordered `ownerIds` with 1–3 current project-member IDs; legacy `ownerId` remains supported. `split` accepts `titles` with 1–20 child titles and is idempotent when the request supplies an `Idempotency-Key`.

- `POST /api/v1/attachments` — upload a task attachment (`task:write`). Send
  `multipart/form-data` with `task` (task ref or ID in the token's project) and
  `file`, plus `Content-Length`. Files must be non-empty, at most 10 MB, with a
  name of at most 240 characters; a task holds at most 10 attachments
  (`409 attachment_limit`). Archived or unknown tasks return `404`. Uploads are
  accepted while another Agent Token holds the claim (review evidence).
  An optional `Idempotency-Key` replays the original `201` response for an
  identical retry (same task, name, type and content digest). Success records an
  `agent.attached` activity event and returns `{ id, name, contentType, size,
createdAt, url }`.
- `GET /api/v1/attachments?task=<ref>` — list a task's attachments (`task:read`).
- `GET /api/v1/attachments?id=<attachment-id>` — download an attachment from the
  token's project (`task:read`). Other projects' attachments return `404`.
  Agent Tokens cannot delete attachments; the browser routes under
  `/api/attachments` remain session-only and same-origin.

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
