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
| Create task       | `kanby task create "<title>" [--status ideas] [--note "..."] --json`                                                                  |
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

Deadlines are date-only values in `YYYY-MM-DD` format. Set one only when the user or authoritative task context supplies an unambiguous date; never invent or infer it. `task create` has no deadline option, so create first and then use `task update --due`. Clear an existing deadline with `--due ""` only when explicitly requested.

Task tags are exactly `产品`, `设计`, `代码`, or `增长`. Archive only on explicit user instruction. Archived tasks can be restored in Kanby; permanent deletion is not available through Agent Tokens.

Checklist item numbers are one-based and match the current display order; item IDs and unambiguous ID prefixes are also accepted. Re-list after concurrent changes. Acceptance conditions belong in the structured checklist, not in the task description, and must only be checked when supporting evidence exists.

For automatic Pull Request association, put `Kanby-Task: <ref>` on its own line in the PR body or name the branch `kanby/<ref>-description`. Project owners can disable this rule in Kanby Settings; `task link` remains the explicit fallback.

Exit codes: `0` success, `1` validation/network/general error, `2` authentication error, `3` claim or idempotency conflict.
