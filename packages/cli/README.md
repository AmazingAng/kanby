# Kanby CLI + Codex Skill

Use Kanby from a terminal, CI job, or coding agent. The CLI and Kanby coding-agent skill are maintained in the Kanby monorepo so application API changes, CLI behavior, and integration tests ship together.

## Install the CLI

From a Kanby repository checkout:

```bash
npm install
npm install --global ./packages/cli
```

Create a project Agent Token in **Kanby → Settings → CLI 与 Coding Agent**. For agents and CI, expose it through the environment:

```bash
export KANBY_TOKEN="kby_..."
kanby auth status
```

CLI 0.4.1+ defaults to `https://kanby.dev`. Server selection uses `KANBY_URL`, then the saved CLI config URL, then this default. Keep `KANBY_URL` set to your own origin for a self-hosted instance. Run `kanby --help` for all commands and add `--json` for machine-readable output.

To store a validated token in the local CLI config instead, run `kanby auth login` with `KANBY_TOKEN` set. Kanby writes the config with user-only permissions.

To move an existing official-service configuration to the new domain, run `KANBY_URL=https://kanby.dev kanby auth login` with `KANBY_TOKEN` set. This validates access before saving the new URL. Existing valid project tokens continue to work after the migration; they are not tied to the hostname. The legacy public address forwards API traffic for compatibility.

## Install the skill

```bash
npx skills add https://github.com/AmazingAng/kanby --skill kanby
```

The skill guides coding agents through listing work, claiming a task, reporting meaningful progress, associating a GitHub PR, and completing or releasing the task safely.

## Create a card with a deadline

With CLI 0.3.0+ and a server supporting deadline creation:

```bash
kanby task create "Release v1" --due 2026-09-30 --note "Agreed release scope" --json
```

Deadlines use `YYYY-MM-DD` with no timezone conversion. Omit `--due` when none is requested. Use the returned task reference to inspect or change it:

```bash
kanby task get <ref> --json
kanby task update <ref> --due 2026-10-02 --json
kanby task update <ref> --due "" --json
```

The final command explicitly clears the deadline. If an older server omits `due` from the creation result, update that same task with `task update --due` instead of creating another card.

## Verify the checklist and hand off for acceptance

```bash
kanby task list --json
kanby task claim <ref> --lease 15 --json
kanby task get <ref> --json
kanby task checklist add <ref> "Tests pass" --json
kanby task checklist <ref> --json
```

Run the required tests first. Only after they pass, use the corresponding checklist item ID:

```bash
kanby task progress <ref> "Required tests passed" --json
kanby task checklist check <ref> <item-id> --json
kanby task checklist <ref> --json
# Only the user runs this after accepting the full deliverable:
kanby task complete <ref> --message "All acceptance criteria verified; tests pass" --json
```

Repeat validation and `check` for each criterion, then re-read the list before handoff. Item numbers (starting at 1) are supported, but stable IDs avoid selecting a different item after concurrent reordering. Agents leave the card in `building` for human acceptance; the user manually marks it complete. `complete` updates the task status but does not check checklist items or verify their evidence. Leave unverified work open.

Use the example completion message only when both the acceptance criteria and required tests have actually been verified.

Archive only when requested, using `kanby task archive <ref>`.

Task tags are `产品`, `设计`, `代码`, or `增长`. Archiving is recoverable from
the Kanby archive; permanent deletion is intentionally unavailable to Agent
Tokens.

Task mutations support `--idempotency-key <stable-key>` for safe retries. Never commit or print an Agent Token.

## Requirements

- Node.js 20 or newer
- A Kanby project Agent Token

## License

MIT

## Review team delivery

```bash
kanby report --from 2026-09-07 --to 2026-09-13 --timezone Asia/Shanghai --json
kanby activity --limit 50 --json
kanby activity --cursor '<nextCursor>' --json
```

Reports include a fixed planned cohort, distinct completed top-level tasks,
completion-time shared credit, membership duration and data-quality warnings.
Historical coverage is explicit; incomplete periods return null rates. Task
throughput is not an individual productivity ranking or proof of deployment.
Activity pagination includes human and GitHub work as well as Agent updates.

## Record project and task interactions

With CLI 0.5.0+ and server migration 0016, record Agent sessions in the Token's
project with an optional task. Each person must use their own Token. Session
start/end never claim, complete or modify a task.

```bash
kanby session start --client codex --context "Project implementation" --json
kanby session prompt <session-id> --json
kanby session wait <session-id> --reason review --json
kanby session reply <session-id> --request <wait-id> --decision changes --json
kanby session end <session-id> --outcome handed-off --json
kanby session list --json
kanby session events <session-id> --json
kanby session report --from 2026-09-24 --to 2026-09-30 --timezone Asia/Shanghai --json
```

Use the returned `wait.id` for the corresponding real response. `prompt` records
an incoming user turn without copying its contents; an unrelated message does
not answer an open wait. `note`, `heartbeat`, `pause` and `resume` cover other
lifecycle events. Commands accept `KANBY_SESSION_ID` instead of the positional
session ID. Events support `--event-id` and `--revision` for identical retries;
start supports `--id`. Errors print retry identifiers and exit nonzero. List and
event pages support `--cursor` / `--limit` (1–50); follow `nextCursor` until null.
`list` also filters by `--task` or `--member` (member ID).

Wait reasons: `input`, `review`, `approval`, `acceptance`. Reply decisions:
`continue`, `accept`, `changes`, `defer`. End outcomes: `completed`, `handed-off`,
`cancelled`, `failed`. Optional summaries use `--summary`, at most 500 characters;
no transcript or output is uploaded automatically.

`kanby session run --client my-agent -- my-agent <args>` supervises an executable,
exports `KANBY_SESSION_ID`, forwards terminal I/O and sends periodic heartbeats.
Successful work waits for acceptance unless the child already handed off or
ended. Nonzero exits end failed/cancelled. The supervisor does not interpret I/O
as human interaction; use the skill or a client integration for prompt/reply
signals. Provider-specific hook adapters are not bundled.

CLI events are **Agent-reported**, including replies. Only the browser's
cookie-authenticated session API can record **verified-user** responses; even
those do not prove review quality. Reports separate these samples and show
pending waits and stale sessions. Five minutes without events means unknown
liveness, not abandonment. Calendar latency includes nights and weekends.
Only instrumented activity is observed; coverage is never claimed complete.
There is no offline spool, and reports fail explicitly above 10,000 events.

See the repository's [session integration guide](https://github.com/AmazingAng/kanby/blob/main/skills/kanby/references/sessions.md)
for the full skill workflow and metric definitions. This feature requires a
server deployment and migration; installing a new CLI alone does not add the API.
