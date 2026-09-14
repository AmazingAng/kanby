# SPEC — CLI archive and tag validation

- Tier: 3 — public Agent API and recoverable task lifecycle mutation
- Spec approval: not obtained (autonomous run after the user approved the feature-level fix)
- Setup plan:
  - Tools to install: none
  - Git isolation: branch `codex/cli-archive-tag-validation`
  - Gauntlet files: reuse `tools/gauntlet.sh` and `tools/mutants.mjs`; add this spec and `docs/reliability/cli-archive-tag-validation-evidence.md`
  - New dependencies: none

## Failure model

- A typo in `--tag` reaches the server and produces an unhelpful generic error: cover with a CLI contract test that proves no request is sent.
- An Agent archives a task claimed by another Agent: enforce the existing active-claim boundary and return HTTP 409 without changing the task.
- An Agent archives a task outside its token project: resolve only active tasks in the authenticated project and return HTTP 404.
- A retried archive creates duplicate activity or fails after the first write: keep the existing idempotency reservation/replay contract and test replay.
- An archived task remains visible in active task lists: assert it moves to the archived query only.
- Archive activity is attributed to a browser user instead of the Agent token identity: assert `source=agent` and the token actor fields.
- Archive accidentally becomes permanent deletion: use only `setTaskArchived`; do not expose a delete action.

## Scenarios

1. Given `kanby task update KANBY-1 --tag 代码`, when the CLI parses the update, then it sends `tag: "代码"` to the API.
2. Given `kanby task update KANBY-1 --tag cli-smoke`, when the CLI validates the tag, then it exits 1 with `Tag must be one of: 产品, 设计, 代码, 增长`, sends no network request, and never includes the token in output.
3. Given CLI help or README, when a user looks up `task update`, then the four accepted tag values are visible.
4. Given an active project task with no conflicting claim, when the authenticated Agent sends action `archive`, then the API returns the archived task, removes it from active task listing, retains it in archived listing, and records Agent-attributed archive activity.
5. Given the same archive request and idempotency key is replayed, then the API returns the original success without another archive event.
6. Given another Agent owns an active claim, when this Agent attempts archive, then the API returns HTTP 409 and the task remains active.
7. Given an active task reference, when `kanby task archive <ref>` runs, then it sends the archive action and prints/returns the archived task.
8. Given this Agent owns an active claim, when it archives the task, then the claim is released; given a task in another project, its reference remains unresolved and unchanged.

## Must NOT

- Do not add permanent deletion to the Agent API or CLI.
- Do not allow archive to bypass project scoping, authentication, write scope, active claims, optimistic revision handling, or idempotency.
- Do not change existing browser archive semantics or existing CLI command payloads.
- Do not add dependencies, migrations, or persist/log Agent tokens.

## Revisions

- Initial autonomous specification based on the approved fixes.
- Added explicit own-claim cleanup and cross-project non-resolution checks after implementation review exposed those lifecycle boundaries.
- Made claim cleanup part of the archive database batch so a response failure cannot leave an archived task with a live Agent claim.
