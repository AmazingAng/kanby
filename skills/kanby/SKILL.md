---
name: kanby
description: Coordinate with teammates and their agents on Kanby cards through the CLI. Use to find what is waiting on you (kanby next), read and answer comments, claim code work, report progress, hand cards to someone for acceptance, review or decisions, and review team delivery.
---

# Kanby

Use the `kanby` CLI as the single interface to Kanby. Prefer `--json` when consuming output programmatically. Read [references/cli.md](references/cli.md) for commands, deadline examples, completion examples, and exit codes.

The official service is `https://kanby.dev` (CLI 0.4.1+ default). Respect an explicit self-hosted URL. For installation, saved legacy URLs, or missing CLI commands, see the connection setup in [references/cli.md](references/cli.md).

## Start here: whose turn is it

Kanby tracks whose turn each card is: a member or a member's agent (shown as
"<member> 的 <agent>"), with a reason and the time it started. Your token acts
on behalf of its member.

1. On start and whenever you resume, run `kanby next --json` (CLI 0.7.0+). It
   lists cards whose turn is you, any agent of your member, or your member
   personally, open @mentions, and how many new entries each card has.
2. For each card you work on, run `kanby task get <ref> --json` and read
   `turn`, `thread` and `unread`. Answer every human comment in `unread`: do
   what it asks or reply with `kanby task comment`. Reading advances your read
   cursor; use `--no-mark-read` to peek.
3. If `kanby next` is missing, the CLI or server is older: say so, fall back to
   `task list`/`task get`, and read comments with `kanby activity --task <ref>`.

## Talk on the card, not in chat

- Ask questions and request decisions with `kanby task comment <ref> "@login …"`;
  `@login/agent` addresses a teammate's agent. Mentions notify the person.
- When you need a decision before continuing, also hand the card over:
  `kanby task handoff <ref> --to @login --reason awaiting_decision --note "<the question and options>"`.
- Use `--reason blocked` with what is blocking, and `awaiting_review` to ask a
  teammate's agent or a member to review.
- Never cite local paths (`reports/…`, `/Users/…`, `docs/…` files that are not
  committed) in progress, comments or notes: teammates cannot open them. Upload
  evidence with `kanby task attach <ref> <file>` and refer to the attachment name.

## Record project interactions

Sessions are optional telemetry, not a question channel: ask on the card with
comments and handoffs instead of `session wait`. When the user has selected a
Kanby project and enabled interaction collection,
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

1. Run `kanby auth status --json`. If authentication is missing, tell the user to create a project Agent Token in Kanby Settings and either expose it as `KANBY_TOKEN` or run `kanby auth login` themselves (hidden prompt, or `--token-stdin` for a pipe); never ask them to paste it into chat. Saved tokens (CLI 0.8.0+) apply only to the server origin they were saved for, so a different `KANBY_URL` needs its own login or `KANBY_TOKEN`.
2. Run `kanby task list --json` and select a task that clearly matches the user's request. When the user asks to create a card, use `kanby task create "<title>" --note "<context>" --due YYYY-MM-DD --json`, omitting `--due` when no deadline was given. Use the returned `ref` for subsequent commands. Do not silently create a duplicate or switch projects.
3. Set deadlines only from the user or authoritative task context. Use a concrete `YYYY-MM-DD` calendar date without timezone conversion; if the date is ambiguous, report the ambiguity rather than guessing. For existing tasks, use `kanby task update <ref> --due YYYY-MM-DD --json`; clear a date with `--due ""` only when requested.
4. Claim the task before editing code: `kanby task claim <ref> --lease 15 --json`. Then read its full context with `kanby task get <ref> --json`. The claim only means "I am changing this code" and prevents two agents from editing the same work; comments, review notes, progress, handoffs and attachments do not need it, so reviewers can always write on a card another agent holds.

## Work and acceptance criteria

- Keep descriptions for context. Include review, audit, deployment, and live verification in acceptance conditions when they are part of the agreed deliverable; do not assume every task requires them. If `kanby --help` lists `task checklist`, use the structured checklist and add missing concrete criteria before implementation. With an older CLI that lacks checklist commands, read the task with `task get` and record criteria, evidence, and remaining work in `progress`; do not treat the missing command as proof that no acceptance remains.
- Keep one card for one agreed deliverable. Implementation, testing, audit, review, PR, deployment, and post-deployment checks are stages of that card. Record their results and remaining work on the existing card instead of creating or splitting cards for each stage. Split only when the user or task explicitly calls for separately deliverable outcomes; do not split a child again.
- Renew the claim with `heartbeat` during long work. Record `progress` at meaningful checkpoints, including validation evidence, rather than for routine tool calls.
- Attach evidence that is useful to teammates (screenshots, logs, generated reports) with `kanby task attach <ref> <file> --json`; reference the attachment by name in the progress update or handoff note instead of a local path. Never attach secrets or credentials.
- When creating a Pull Request, add a standalone `Kanby-Task: <ref>` trailer to its body (or use a `kanby/<ref>-description` branch). If project automation is disabled or the PR already exists, link it explicitly with `kanby task link <ref> <url> --json`.
- GitHub automation can move a linked card to `shipped` when its PR merges or Issue closes, regardless of this skill's completion rule. The CLI does not expose that project setting. For human acceptance, tell the project owner to set its completion target to `off`; if the setting is unknown, disclose that the rule is not enforced by the skill alone. After such an event, inspect the card and activity. Report a premature `shipped` status and pending work without overwriting a later human decision.

## Finish a task

Finishing an agent's current work session, passing local tests, opening or merging a PR, or deploying one environment does not by itself complete the task. Judge completion against the full agreed deliverable and its remaining acceptance steps.

1. Re-read the task and its current checklist when the CLI supports one. Validate each agreed criterion and record supporting evidence in a meaningful progress update. Check only verified checklist items, using IDs from a fresh list because display numbers can change.
2. Re-read the checklist when supported. If a criterion fails, remains unverified, or changed concurrently, report the remaining work. Do not remove, rewrite, or check an item just to make completion possible.
3. Even when all criteria pass, report the evidence and hand the card to a person for acceptance, saying exactly what to check:
   `kanby task handoff <ref> --to owner --reason awaiting_acceptance --note "<what to check, which attachments>" --json`.
   Use `--to @login` when someone other than your member accepts. Do not call `kanby task complete`; the person marks the card complete. The handoff releases your claim and leaves the card in `building`; do not merely write "待验收" in progress and release.
4. If acceptance is rejected, the card comes back to you (or your member) with `developing`/`blocked` and a note: read it with `task get` before continuing.

Archive only when the user asks to remove a task from the active board: `kanby task archive <ref> --json`. Archiving is recoverable; Agent Tokens cannot permanently delete tasks. When handing unfinished work to a teammate or their agent, use `handoff --to @login[/agent] --reason developing --note "<done, remaining, risks, attachments>"`. If abandoning work, release the claim instead of marking the task complete.

Use a stable `--idempotency-key` when retrying a mutation whose prior response is unknown. Never print, log, commit, or place `KANBY_TOKEN` in command arguments (do not use `kanby auth login --token`).

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
