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
- `POST /api/v1/tasks` — create a task.
- `PATCH /api/v1/tasks` — mutate a task with `action`: `update`, `split`, `claim`, `heartbeat`, `progress`, `release`, `link`, or `complete`. An `update` may send ordered `ownerIds` with 1–3 current project-member IDs; legacy `ownerId` remains supported. `split` accepts `titles` with 1–20 child titles and is idempotent when the request supplies an `Idempotency-Key`.

Task JSON includes ordered `owners` for every assignee and retains `owner` as the first assignee for compatibility. Human-readable CLI task output lists every assignee login.

Task reads include an ordered `acceptanceCriteria` array. Each item contains
`id`, `body`, `completed`, `position`, `createdAt`, and `updatedAt`. The CLI
renders it as a Markdown-style `[ ]` / `[x]` checklist in `task get`; JSON mode
preserves the structured array.

Every successful Agent mutation is also written to the task's unified activity timeline. Repeated heartbeats for the same claim are coalesced, while progress messages remain visible to teammates and power the compact “Agent 正在处理” state on the board card. Releasing or completing a task clears the live card state; its history remains in the timeline.

When an Agent creates a Pull Request, it should add `Kanby-Task: <task ref>` as a standalone trailer in the PR body or use a `kanby/<task ref>-description` branch. If the project's PR auto-link rule is enabled, the verified GitHub webhook associates that PR with the active task. The explicit `link` action remains available as a fallback.

For retryable mutations, send a stable `Idempotency-Key` header between 8 and 128 characters. A claim is a renewable 1–60 minute lease. GitHub links are accepted only for repositories selected in the corresponding Kanby project.

Successful responses use `{ "ok": true, "data": ... }`. Errors use `{ "ok": false, "error": { "code": "...", "message": "..." } }`.
