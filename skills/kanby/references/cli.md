# Kanby CLI reference

Set `KANBY_TOKEN` for agents and CI. `KANBY_URL` is optional and defaults to the hosted Kanby service.

| Intent            | Command                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Verify access     | `kanby auth status --json`                                                                                                            |
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
| Complete          | `kanby task complete <ref> [--message "..."] --json`                                                                                  |
| Archive           | `kanby task archive <ref> --json`                                                                                                     |
| Release           | `kanby task release <ref> --json`                                                                                                     |

Task refs are the short prefixes returned by list/create. Mutations accept `--idempotency-key <stable-key>`.

Deadlines are date-only values in `YYYY-MM-DD` format. Set one only when the user or authoritative task context supplies an unambiguous date; never invent or infer it. `task create --due` sends the deadline in the creation request (CLI 0.3.0+ and a server with deadline creation support). Confirm the returned `due`; an older server may ignore a field it does not know. When it is absent, update the returned task reference with `task update --due` instead of creating another card. Clear an existing deadline with `--due ""` only when explicitly requested.

Task tags are exactly `产品`, `设计`, `代码`, or `增长`. Archive only on explicit user instruction. Archived tasks can be restored in Kanby; permanent deletion is not available through Agent Tokens.

Checklist item numbers are one-based and match the current display order; item IDs and unambiguous ID prefixes are also accepted. Re-list after concurrent changes. Acceptance conditions belong in the structured checklist, not in the task description, and must only be checked when supporting evidence exists.

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

## Verify, check, then complete

Descriptions and checklist items are separate data. When defining acceptance conditions:

```bash
kanby task checklist add <ref> "The new deadline survives a task reload" --json
kanby task checklist add <ref> "Invalid dates do not create a card" --json
```

At completion, read the current checklist and perform the checks it requires. After the corresponding evidence exists:

```bash
kanby task checklist <ref> --json
kanby task progress <ref> "Verified deadline persistence and rejection of invalid dates with passing integration tests" --json
kanby task checklist check <ref> <first-verified-item-id> --json
kanby task checklist check <ref> <second-verified-item-id> --json
kanby task checklist <ref> --json
kanby task complete <ref> --message "Deadline creation verified; all acceptance criteria passed" --json
```

Replace item placeholders with IDs from the current list. `check <ref> 1` also selects the first current item; prefer IDs when concurrent edits are possible. Re-list and resolve again after a conflict. If any item remains unverified, report the blocker and leave the task open. `complete` does not automatically tick a checklist, and a successful API response is not evidence that the acceptance criteria passed.
