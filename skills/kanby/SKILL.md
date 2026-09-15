---
name: kanby
description: Manage Kanby cards, deadlines, and acceptance checklists through the CLI. Use when an agent needs to create or claim tasks, report progress, and complete verified work.
---

# Kanby

Use the `kanby` CLI as the single interface to Kanby. Prefer `--json` when consuming output programmatically. Read [references/cli.md](references/cli.md) for commands, deadline examples, completion examples, and exit codes.

## Find or create a task

1. Run `kanby auth status --json`. If authentication is missing, tell the user to create a project Agent Token in Kanby Settings and expose it as `KANBY_TOKEN`; never ask them to paste it into chat.
2. Run `kanby task list --json` and select a task that clearly matches the user's request. When the user asks to create a card, use `kanby task create "<title>" --note "<context>" --due YYYY-MM-DD --json`, omitting `--due` when no deadline was given. Use the returned `ref` for subsequent commands. Do not silently create a duplicate or switch projects.
3. Set deadlines only from the user or authoritative task context. Use a concrete `YYYY-MM-DD` calendar date without timezone conversion; if the date is ambiguous, report the ambiguity rather than guessing. For existing tasks, use `kanby task update <ref> --due YYYY-MM-DD --json`; clear a date with `--due ""` only when requested.
4. Claim the task before editing code: `kanby task claim <ref> --lease 15 --json`. Then read its full context with `kanby task get <ref> --json`.

## Work and acceptance criteria

- Keep descriptions for context. Put acceptance conditions in the structured checklist with `kanby task checklist add <ref> "<criterion>" --json`, not Markdown checkboxes in the description. If there is no checklist, add concrete, verifiable criteria from the agreed requirements before implementation.
- If the task contains independently deliverable pieces, split it once with `kanby task split <ref> "<child one>" "<child two>" --json`. Do not split a child again.
- Renew the claim with `heartbeat` during long work. Record `progress` at meaningful checkpoints, including validation evidence, rather than for routine tool calls.
- When creating a Pull Request, add a standalone `Kanby-Task: <ref>` trailer to its body (or use a `kanby/<ref>-description` branch). If project automation is disabled or the PR already exists, link it explicitly with `kanby task link <ref> <url> --json`.

## Finish a task

1. Fetch the current checklist: `kanby task checklist <ref> --json`.
2. Validate each criterion and record the supporting result in a meaningful progress update. Check only verified items with `kanby task checklist check <ref> <item-id> --json`. Prefer IDs from the fresh list; one-based display numbers also work, but can change when another person edits the checklist.
3. Fetch the checklist again and confirm that every agreed criterion is checked. If a criterion fails, remains unverified, or changed concurrently, keep the task open and report what remains. Do not remove, rewrite, or check an item just to make completion possible.
4. Only then run `kanby task complete <ref> --message "<result and validation summary>" --json`. Inspect the returned status and checklist. `complete` changes the task status and records the summary; it **does not check acceptance items for you**.

Archive only when the user asks to remove a task from the active board: `kanby task archive <ref> --json`. Archiving is recoverable; Agent Tokens cannot permanently delete tasks. If abandoning work, release the claim instead of marking the task complete.

Use a stable `--idempotency-key` when retrying a mutation whose prior response is unknown. Never print, log, commit, or place `KANBY_TOKEN` in command arguments.
