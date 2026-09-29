---
name: kanby
description: Manage Kanby tasks and review team delivery through the CLI. Use for cards, deadlines, acceptance checklists, progress updates, and weekly completion or per-member throughput reports.
---

# Kanby

Use the `kanby` CLI as the single interface to Kanby. Prefer `--json` when consuming output programmatically. Read [references/cli.md](references/cli.md) for commands, deadline examples, completion examples, and exit codes.

The official service is `https://kanby.dev` (CLI 0.4.1+ default). Respect an explicit self-hosted URL. For installation, saved legacy URLs, or missing CLI commands, see the connection setup in [references/cli.md](references/cli.md).

## Find or create a task

1. Run `kanby auth status --json`. If authentication is missing, tell the user to create a project Agent Token in Kanby Settings and expose it as `KANBY_TOKEN`; never ask them to paste it into chat.
2. Run `kanby task list --json` and select a task that clearly matches the user's request. When the user asks to create a card, use `kanby task create "<title>" --note "<context>" --due YYYY-MM-DD --json`, omitting `--due` when no deadline was given. Use the returned `ref` for subsequent commands. Do not silently create a duplicate or switch projects.
3. Set deadlines only from the user or authoritative task context. Use a concrete `YYYY-MM-DD` calendar date without timezone conversion; if the date is ambiguous, report the ambiguity rather than guessing. For existing tasks, use `kanby task update <ref> --due YYYY-MM-DD --json`; clear a date with `--due ""` only when requested.
4. Claim the task before editing code: `kanby task claim <ref> --lease 15 --json`. Then read its full context with `kanby task get <ref> --json`.

## Work and acceptance criteria

- Keep descriptions for context. Put acceptance conditions in the structured checklist with `kanby task checklist add <ref> "<criterion>" --json`, not Markdown checkboxes in the description. If there is no checklist, add concrete, verifiable criteria from the agreed deliverable before implementation. Include review, audit, deployment, and live verification when they are part of that deliverable; do not assume every task requires them.
- Keep one card for one agreed deliverable. Implementation, testing, audit, review, PR, deployment, and post-deployment checks are stages of that card. Record their results and remaining work on the existing card instead of creating or splitting cards for each stage. Split only when the user or task explicitly calls for separately deliverable outcomes; do not split a child again.
- Renew the claim with `heartbeat` during long work. Record `progress` at meaningful checkpoints, including validation evidence, rather than for routine tool calls.
- When creating a Pull Request, add a standalone `Kanby-Task: <ref>` trailer to its body (or use a `kanby/<ref>-description` branch). If project automation is disabled or the PR already exists, link it explicitly with `kanby task link <ref> <url> --json`.
- After a linked PR merges or Issue closes, re-read the card. Project automation may move it to `shipped`; if agreed acceptance remains, restore `building` and record the pending work. An automatic status change is not acceptance evidence.

## Finish a task

Finishing an agent's current work session, passing local tests, opening or merging a PR, or deploying one environment does not by itself complete the task. Judge completion against the full agreed deliverable and its remaining acceptance steps.

1. Fetch the current checklist: `kanby task checklist <ref> --json`.
2. Validate each criterion and record the supporting result in a meaningful progress update. Check only verified items with `kanby task checklist check <ref> <item-id> --json`. Prefer IDs from the fresh list; one-based display numbers also work, but can change when another person edits the checklist.
3. Fetch the checklist again and confirm that every agreed criterion is checked. If a criterion fails, remains unverified, or changed concurrently, keep the task in `building` and report what remains. Do not remove, rewrite, or check an item just to make completion possible.
4. Even when all criteria pass, do not call `kanby task complete` on your own initiative. Report the evidence and hand the card to the user for acceptance. Only run `kanby task complete <ref> --message "<result and validation summary>" --json` when the user explicitly authorizes marking that particular Kanby card complete and the agreed criteria are verified. Inspect the returned status and checklist. `complete` changes the task status; it **does not check acceptance items for you**. An instruction to implement or validate work alone is not authorization to mark the card complete.

Archive only when the user asks to remove a task from the active board: `kanby task archive <ref> --json`. Archiving is recoverable; Agent Tokens cannot permanently delete tasks. When handing off unfinished or pending-acceptance work, record the remaining steps and release the claim; releasing a claim does not complete the card. If abandoning work, release the claim instead of marking the task complete.

Use a stable `--idempotency-key` when retrying a mutation whose prior response is unknown. Never print, log, commit, or place `KANBY_TOKEN` in command arguments.

## Review a team's delivery

For weekly progress or efficiency reviews, use `kanby report --from YYYY-MM-DD
--to YYYY-MM-DD --timezone <IANA-zone> --json`. Resolve the requested calendar week
and timezone first. Read [references/reporting.md](references/reporting.md) for the
metric definitions and historical coverage limits. Use `kanby activity --json`
and follow `nextCursor` to inspect human, Agent and GitHub evidence; `task get`
contains only a recent Agent excerpt. This is a read-only workflow: do not claim,
create, complete or rewrite cards merely to produce a review.
