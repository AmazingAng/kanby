---
name: kanby
description: Manage Kanby tasks and record human–Agent interactions within a selected Kanby project through the CLI. Use for project or task sessions, handoffs, acceptance, progress, and team delivery reviews.
---

# Kanby

Use the `kanby` CLI as the single interface to Kanby. Prefer `--json` when consuming output programmatically. Read [references/cli.md](references/cli.md) for commands, deadline examples, completion examples, and exit codes.

The official service is `https://kanby.dev` (CLI 0.4.1+ default). Respect an explicit self-hosted URL. For installation, saved legacy URLs, or missing CLI commands, see the connection setup in [references/cli.md](references/cli.md).

## Record project interactions

When the user has selected a Kanby project and enabled interaction collection,
read [references/sessions.md](references/sessions.md). Record each user turn,
Agent work session and handoff, including project discussions without a task
card. Retain the session ID across turns. Use an open wait plus its matching reply
to measure response time; normal progress updates do not mean waiting for a human.
Use metadata-only events by default. Agent-reported replies are not independently
verified reviews. Missing telemetry is unknown activity, not inactivity.

Check `kanby --help` for `session` commands. If the CLI or server lacks them,
report the collection gap and the required upgrade; do not fabricate history or
block the user's unrelated work. Collection cannot cover clients where the skill
or a lifecycle integration is not active.

## Find or create a task

1. Run `kanby auth status --json`. If authentication is missing, tell the user to create a project Agent Token in Kanby Settings and expose it as `KANBY_TOKEN`; never ask them to paste it into chat.
2. Run `kanby task list --json` and select a task that clearly matches the user's request. When the user asks to create a card, use `kanby task create "<title>" --note "<context>" --due YYYY-MM-DD --json`, omitting `--due` when no deadline was given. Use the returned `ref` for subsequent commands. Do not silently create a duplicate or switch projects.
3. Set deadlines only from the user or authoritative task context. Use a concrete `YYYY-MM-DD` calendar date without timezone conversion; if the date is ambiguous, report the ambiguity rather than guessing. For existing tasks, use `kanby task update <ref> --due YYYY-MM-DD --json`; clear a date with `--due ""` only when requested.
4. Claim the task before editing code: `kanby task claim <ref> --lease 15 --json`. Then read its full context with `kanby task get <ref> --json`.

## Work and acceptance criteria

- Keep descriptions for context. Include review, audit, deployment, and live verification in acceptance conditions when they are part of the agreed deliverable; do not assume every task requires them. If `kanby --help` lists `task checklist`, use the structured checklist and add missing concrete criteria before implementation. With an older CLI that lacks checklist commands, read the task with `task get` and record criteria, evidence, and remaining work in `progress`; do not treat the missing command as proof that no acceptance remains.
- Keep one card for one agreed deliverable. Implementation, testing, audit, review, PR, deployment, and post-deployment checks are stages of that card. Record their results and remaining work on the existing card instead of creating or splitting cards for each stage. Split only when the user or task explicitly calls for separately deliverable outcomes; do not split a child again.
- Renew the claim with `heartbeat` during long work. Record `progress` at meaningful checkpoints, including validation evidence, rather than for routine tool calls.
- When creating a Pull Request, add a standalone `Kanby-Task: <ref>` trailer to its body (or use a `kanby/<ref>-description` branch). If project automation is disabled or the PR already exists, link it explicitly with `kanby task link <ref> <url> --json`.
- GitHub automation can move a linked card to `shipped` when its PR merges or Issue closes, regardless of this skill's completion rule. The CLI does not expose that project setting. For human acceptance, tell the project owner to set its completion target to `off`; if the setting is unknown, disclose that the rule is not enforced by the skill alone. After such an event, inspect the card and activity. Report a premature `shipped` status and pending work without overwriting a later human decision.

## Finish a task

Finishing an agent's current work session, passing local tests, opening or merging a PR, or deploying one environment does not by itself complete the task. Judge completion against the full agreed deliverable and its remaining acceptance steps.

1. Re-read the task and its current checklist when the CLI supports one. Validate each agreed criterion and record supporting evidence in a meaningful progress update. Check only verified checklist items, using IDs from a fresh list because display numbers can change.
2. Re-read the checklist when supported. If a criterion fails, remains unverified, or changed concurrently, report the remaining work. Do not remove, rewrite, or check an item just to make completion possible.
3. Even when all criteria pass, report the evidence and hand the card to the user for acceptance. Do not call `kanby task complete`; the user manually marks the card complete. Leave it in `building` and release the claim when handing it off.

Archive only when the user asks to remove a task from the active board: `kanby task archive <ref> --json`. Archiving is recoverable; Agent Tokens cannot permanently delete tasks. When handing off unfinished or pending-acceptance work, record the remaining steps and release the claim; releasing a claim does not complete the card. If abandoning work, release the claim instead of marking the task complete.

Use a stable `--idempotency-key` when retrying a mutation whose prior response is unknown. Never print, log, commit, or place `KANBY_TOKEN` in command arguments.

## Review a team's delivery

For human–Agent collaboration reviews, use `kanby session report` and read
[references/sessions.md](references/sessions.md) for provenance and coverage.

For weekly progress or efficiency reviews, use `kanby report --from YYYY-MM-DD
--to YYYY-MM-DD --timezone <IANA-zone> --json`. Resolve the requested calendar week
and timezone first. Read [references/reporting.md](references/reporting.md) for the
metric definitions and historical coverage limits. Use `kanby activity --json`
and follow `nextCursor` to inspect human, Agent and GitHub evidence; `task get`
contains only a recent Agent excerpt. This is a read-only workflow: do not claim,
create, complete or rewrite cards merely to produce a review.
