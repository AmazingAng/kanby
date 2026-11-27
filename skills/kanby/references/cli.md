# Kanby CLI reference

## Connection setup

Set `KANBY_TOKEN` for agents and CI. CLI 0.4.1+ defaults to `https://kanby.dev`. URL precedence is `KANBY_URL`, then the saved CLI config URL, then the default. Preserve explicit self-hosted URLs.

If an older CLI or saved official-service configuration still selects `https://kanby.0xaa.workers.dev`, set `KANBY_URL=https://kanby.dev` for the session. To persist the new URL, run `KANBY_URL=https://kanby.dev kanby auth login` with `KANBY_TOKEN` already set; credentials and the URL are saved only after successful authentication. Existing valid project Agent Tokens remain usable after the domain migration.

If `kanby` is not installed and a Kanby checkout is available, run `node packages/cli/bin/kanby.js <command>` from its root, or install it with `npm install --global ./packages/cli`. Do not confuse a missing executable or missing credentials with a server outage. `auth status --json` and `task list --json` provide read-only connectivity checks; a 401 response does not confirm successful authentication.

## Commands

| Intent            | Command                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Verify access     | `kanby auth status --json`                                                                                                            |
| Your queue        | `kanby next --json`                                                                                                                   |
| Comment / ask     | `kanby task comment <ref> "@login …" --json`                                                                                          |
| Mention           | `kanby task mention <ref> @login[/agent] "…" --json`                                                                                  |
| Hand off          | `kanby task handoff <ref> --to @login\|owner --reason awaiting_acceptance --note "…" --json`                                          |
| List project      | `kanby project list --json`                                                                                                           |
| List tasks        | `kanby task list [--status ideas\|building\|shipped] --json`                                                                          |
| Inspect task      | `kanby task get <ref> --json`                                                                                                         |
| List checklist    | `kanby task checklist <ref> --json`                                                                                                   |
| Add criterion     | `kanby task checklist add <ref> "<criterion>" --json`                                                                                 |
| Edit criterion    | `kanby task checklist edit <ref> <number-or-id> "<criterion>" --json`                                                                 |
| Check criterion   | `kanby task checklist check <ref> <number-or-id> --json`                                                                              |
| Reopen criterion  | `kanby task checklist uncheck <ref> <number-or-id> --json`                                                                            |
| Remove criterion  | `kanby task checklist remove <ref> <number-or-id> --json`                                                                             |
| Create task       | `kanby task create "<title>" [--status ideas] [--note "..."] [--due YYYY-MM-DD] --json`                                               |
| Edit task         | `kanby task update <ref> [--title "..."] [--note "..."] [--status building] [--due YYYY-MM-DD] [--tag 产品\|设计\|代码\|增长] --json` |
| Split into tasks  | `kanby task split <ref> "<child one>" "<child two>" --json`                                                                           |
| Claim work        | `kanby task claim <ref> [--lease 15] --json`                                                                                          |
| Renew claim       | `kanby task heartbeat <ref> [--lease 15] --json`                                                                                      |
| Report checkpoint | `kanby task progress <ref> "<message>" --json`                                                                                        |
| Link GitHub       | `kanby task link <ref> <issue-or-pr-url> --json`                                                                                      |
| Attach file       | `kanby task attach <ref> <file> [--name "..."] [--type <mime>] --json`                                                                |
| List attachments  | `kanby task attachments <ref> --json`                                                                                                 |
| Download file     | `kanby task download <attachment-id> [--output <path>] [--force]`                                                                     |
| Complete          | `kanby task complete <ref> [--message "..."] --json`                                                                                  |
| Archive           | `kanby task archive <ref> --json`                                                                                                     |
| Release           | `kanby task release <ref> --json`                                                                                                     |

Task refs are the short prefixes returned by list/create. Mutations accept `--idempotency-key <stable-key>`.

Deadlines are date-only values in `YYYY-MM-DD` format. Set one only when the user or authoritative task context supplies an unambiguous date; never invent or infer it. `task create --due` sends the deadline in the creation request (CLI 0.3.0+ and a server with deadline creation support). Confirm the returned `due`; an older server may ignore a field it does not know. When it is absent, update the returned task reference with `task update --due` instead of creating another card. Clear an existing deadline with `--due ""` only when explicitly requested.

Task tags are exactly `产品`, `设计`, `代码`, or `增长`. Archive only on explicit user instruction. Archived tasks can be restored in Kanby; permanent deletion is not available through Agent Tokens.

Checklist item numbers are one-based and match the current display order; item IDs and unambiguous ID prefixes are also accepted. Re-list after concurrent changes. When the installed CLI supports checklist commands, put acceptance conditions in the structured checklist and check them only with supporting evidence. Older CLIs may lack those commands; use `task get` and `progress` to record evidence and remaining work without implying the checklist was checked.

For automatic Pull Request association, put `Kanby-Task: <ref>` on its own line in the PR body or name the branch `kanby/<ref>-description`. Project owners can disable this rule in Kanby Settings; `task link` remains the explicit fallback.

Exit codes: `0` success, `1` validation/network/general error, `2` authentication error, `3` claim or idempotency conflict.

## Create with a deadline

For a user-requested “Release v1” card due on September 30, 2026:

```bash
kanby task create "Release v1" --note "Ship the agreed release scope" --due 2026-09-30 --json
```

Use the returned `ref`, and confirm `due` is `2026-09-30`. Omit `--due` when the user has not supplied a deadline. The value is a calendar date, not a timestamp. Invalid dates such as `2026-02-29`, datetimes, and a flag with no value are errors. To remove an existing deadline explicitly:

```bash
kanby task update <ref> --due "" --json
```

## Verify, check, then hand off for acceptance

Descriptions and checklist items are separate data. When defining acceptance conditions:

```bash
kanby task checklist add <ref> "The new deadline survives a task reload" --json
kanby task checklist add <ref> "Invalid dates do not create a card" --json
```

When checklist commands are available, read the current checklist and perform the checks it requires. After the corresponding evidence exists:

```bash
kanby task checklist <ref> --json
kanby task progress <ref> "Verified deadline persistence and rejection of invalid dates with passing integration tests" --json
kanby task checklist check <ref> <first-verified-item-id> --json
kanby task checklist check <ref> <second-verified-item-id> --json
kanby task checklist <ref> --json
# Only the user runs this after accepting the full deliverable:
kanby task complete <ref> --message "Deadline creation verified; all acceptance criteria passed" --json
```

Replace item placeholders with IDs from the current list. `check <ref> 1` also selects the first current item; prefer IDs when concurrent edits are possible. Re-list and resolve again after a conflict. If any item remains unverified, report the blocker and leave the task open. Even when all items pass, leave the card in `building` for the user to mark complete after acceptance. `complete` does not automatically tick a checklist, and a successful API response is not evidence that the acceptance criteria passed.

## Task attachments

CLI 0.6.0+ with a server that provides `/api/v1/attachments` can attach evidence
files (screenshots, logs, reports) to a task. Each file is at most 10 MB and a task
holds at most 10 attachments; empty files are rejected. Uploads need `task:write`,
are accepted while another Agent Token holds the claim (CLI 0.7.0 server), and are
recorded in the task activity. Archived tasks cannot receive uploads. Listing and
downloading need only `task:read`. `download` writes to the attachment name in the
current directory unless `--output` is given and never overwrites an existing file
without `--force`. Attachments cannot be deleted with an Agent Token. Attach only
files the user would expect teammates to see; never attach credentials or
`KANBY_TOKEN`.

```bash
kanby task attach <ref> ./screenshots/after.png --json
kanby task attachments <ref> --json
kanby task download <attachment-id> --output ./after.png
```

## Turns, comments and handoffs

CLI 0.7.0+ with a server that provides `/api/v1/next`. Every open card can name
whose turn it is: a member or a member's agent, with a reason
(`developing`, `awaiting_acceptance`, `awaiting_decision`, `blocked`,
`awaiting_review`), an optional note and the time the turn started.

```bash
kanby next --json
kanby task get <ref> --json                 # turn, thread, unread since your last read (repeat while more remain)
kanby task get <ref> --no-mark-read --json  # peek without advancing the cursor
kanby task comment <ref> "@alice 需要你决定导出格式" --json
kanby task handoff <ref> --to owner --reason awaiting_acceptance \
  --note "验收：1) 登录 2) 退出 3) 附件 report.html" --json
kanby task handoff <ref> --to @bob/agent --reason awaiting_review --note "复核迁移" --json
```

`--to` accepts `@login` (a member), `@login/agent` (any agent of that member),
`@login/<agent name>`, `owner` (your token's member), `self` or `none`. A
handoff releases your claim unless `--keep-claim` is passed. A member handing a
card that awaits acceptance back with `developing`/`blocked` records an
acceptance rejection. Handoffs, rejections and @mentions notify the recipient
through the project's Feishu/WeCom bots when configured. Comments, mentions,
handoffs, progress and attachments never need the claim.

## Historical reports and unified activity

`kanby report --from YYYY-MM-DD --to YYYY-MM-DD --timezone Asia/Shanghai --json`
returns project delivery statistics with explicit coverage, cohort and denominator.
`kanby activity [--task KANBY-21] [--cursor <nextCursor>] [--limit 1..50] --json`
returns a page of human, Agent and GitHub activity, including archived cards.
See [reporting.md](reporting.md) before interpreting completion or per-member rates.

## Project and task interaction sessions

CLI 0.5.0+ provides `session start`, `prompt`, `note`, `wait`, `reply`,
`heartbeat`, `pause`, `resume`, `end`, `get`, `list`, `events`, `report`, and
`run`. Task association is optional; the credential selects the project.
Read [sessions.md](sessions.md) for commands, lifecycle instrumentation, retries,
provenance and reporting limits.
