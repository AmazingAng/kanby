---
name: kanby
description: Operate a Kanby project through the Kanby CLI. Use when a coding agent needs to discover, create, inspect, claim, update, manage acceptance checklists, report progress on, link GitHub work to, complete, or release Kanby tasks.
---

# Kanby

Use the `kanby` CLI as the single interface to Kanby. Prefer `--json` whenever consuming output programmatically.

## Workflow

1. Run `kanby auth status --json`. If authentication is missing, tell the user to create a project Agent Token in Kanby Settings and expose it as `KANBY_TOKEN`; never ask them to paste it into chat.
2. Run `kanby task list --json` and select only a task that clearly matches the user's request. Do not invent a task or silently switch projects.
3. Claim the task before editing code: `kanby task claim <ref> --lease 15 --json`.
4. Read full context: `kanby task get <ref> --json`.
5. Treat acceptance conditions as structured data. Add them with `kanby task checklist add <ref> "<criterion>" --json`, never as Markdown checkboxes in the task description. List the checklist before validation, and check an item only after evidence proves it: `kanby task checklist check <ref> <number-or-id> --json`.
6. Synchronize an explicit deadline with `kanby task update <ref> --due YYYY-MM-DD --json`. Set it only when the user or authoritative task context provides an unambiguous calendar date. Do not invent a deadline, convert a date-only value across time zones, or guess from words such as “soon.” If the date is ambiguous, leave it unchanged and report the ambiguity. Clear it with `--due ""` only when explicitly requested.
7. If the task contains several independently deliverable pieces, split it once with `kanby task split <ref> "<child one>" "<child two>" --json`. Do not split a child again.
8. Renew the claim with `heartbeat` during long work. Record `progress` only at meaningful checkpoints, not for routine tool calls.
9. When creating a Pull Request for the task, add a standalone `Kanby-Task: <ref>` trailer to the PR body (or use a `kanby/<ref>-description` branch). Kanby can then associate the PR automatically. If project automation is disabled or the PR already exists, link it explicitly with `kanby task link <ref> <url> --json`.
10. After validation succeeds and every applicable acceptance item is checked, run `kanby task complete <ref> --message "<concise result>" --json`.
11. If abandoning the task, release it. Do not mark incomplete or unverified work complete.

Use a stable `--idempotency-key` when retrying a mutation whose prior response is unknown. Never print, log, commit, or place `KANBY_TOKEN` in command arguments. Read [references/cli.md](references/cli.md) for command details and exit codes.
