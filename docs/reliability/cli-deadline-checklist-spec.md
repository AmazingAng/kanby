# SPEC — CLI deadlines and acceptance completion

## Scope and setup

This is a Tier 3 public API extension, run autonomously under the user's request
and automatic commit/merge preference. Spec approval is not obtained separately.
Work on `codex/cli-deadlines-checklist` in an isolated worktree with the existing
pinned dependencies linked in; add no dependency and no migration.

Implementation paths: `packages/cli/bin/kanby.js`, `app/api/v1/tasks/route.ts`,
`lib/db.ts`. Update the CLI package version and lockfile, the canonical
`skills/kanby/SKILL.md` and its CLI reference, CLI README, and Agent API docs.
Checks live in `tests/agent-deadline-workflow.test.ts` and `tools/mutants.mjs`.
Evidence will be recorded in `docs/reliability/cli-deadline-checklist-evidence.md`.

## Behaviors

1. `task create "Release" --due 2026-09-30 --json` sends the deadline in the
   POST, and both the response and stored task retain exactly `2026-09-30`.
   Supplying a note must not clear the deadline. No follow-up deadline PATCH
   is needed; the deadline belongs to the initial task insert.
2. An omitted deadline or empty string creates a task with no deadline, keeping
   existing callers compatible. Real calendar dates (including leap days) are
   supported as date-only strings, without timezone conversion.
3. A non-string, an impossible date, or a datetime is rejected with HTTP 400
   `invalid_due` before creating a task or reserving an idempotency key.
4. Retrying creation with the same payload and idempotency key returns the same
   task; reusing that key with a different deadline returns a conflict.
5. `task update <ref> --due ""` sends the empty string and clears the deadline.
   A `--due` flag without a value fails locally instead of silently succeeding.
   Existing freeform API update dates remain compatible in this focused change.
6. The documented completion workflow lists structured criteria, verifies them,
   checks individual item IDs (or current display numbers), lists again, then
   completes the task. A real CLI process against the actual route handlers and
   SQLite-backed D1 adapter must persist those checks and the shipped status.
   `complete` does not automatically check items or validate evidence. Existing
   server completion semantics remain unchanged.
7. The skill explains how to create a requested task with a deadline, how to
   update/clear it, and how to finish the acceptance workflow. It must not invent
   deadlines or mark unverified items complete. No new bulk-check shortcut.

## Failure model and checks

- Silently ignored deadline: CLI-to-API-to-storage workflow and mutation probes.
- Deadline lost while adding a note: creation-with-note regression test.
- Invalid input leaves a partial card: direct API hostile-input tests checking
  both HTTP errors and zero task rows; validation occurs before idempotency.
- Calendar/timezone corruption: generated valid date round trips and leap-day
  boundary cases.
- Duplicate task on retry: idempotent creation and changed-payload conflict tests.
- False completion: document the distinction between checking and completing;
  exercise the explicit checklist workflow against the actual API.
- Scope/auth regressions: existing suite, claim/authorization tests and mutation
  checks remain in the required 13-layer `npm run gauntlet`.

Run RED tests before implementation, the skill validator, the full gauntlet,
and a final adversarial review. Merge and push the verified change to main.
The hosted Worker needs the new create API before remote `--due` works; verify
that runtime when released. Publishing to npm is outside this request.

## Clarification during validation

The empty-value parsing regression is also exercised with `--due ""` before the
creation title, so consuming the empty value cannot shift positional arguments.
`npm version` replaced the dependency symlink with a local install of the same
locked dependency tree; the lockfile dependency versions are unchanged.
