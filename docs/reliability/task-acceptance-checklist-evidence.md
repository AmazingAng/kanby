# EVIDENCE — Task acceptance checklist

## Source identity

- Branch: `codex/fix-kanby-reliability`
- Source-state hash before this evidence file: `357384dc01c7b1a81a4e8d7e89dcecdf30b76798887113fcfbd2c4ff47fd8d7f`
- Source-state file count: 191
- Isolation note: the implementation remains in the existing intentionally dirty working tree; no unrelated user changes were reset or committed.
- Confidence downgrade: the user requested autonomous implementation, so the Tier 3 specification was not separately approved before RED/GREEN work.

## Executable specification

- RED was observed with `tests/task-checklist.test.ts`: the route stub returned HTTP 501 where creation required HTTP 201.
- GREEN covers authenticated create, rename, completion, delete, activity, status invariance, stale writes, cross-origin/auth/project isolation, input bounds, 20-item limit, concurrent updates, ordered reads, and deletion cascade.
- UI-adjacent pure tests cover checklist progress, starter-description clearing, and same-column parent/child grouping.
- CLI integration verifies `[x]` and `[ ]` acceptance output.

## Fresh gauntlet

- Command: `npm run gauntlet`
- Result: `GAUNTLET PASS: 11/11 layers`
- Tests: 82/82 passed across 14 files, including shuffled order with seed `9082026`.
- Coverage: 95.52% statements, 89.32% branches, 100% functions, and 99.43% lines for the configured reliability surface.
- Mutation testing: 27/27 mutants killed, including the checklist length/limit and UI hierarchy/progress constraints.
- TypeScript, lint, formatting, production dependency audit, secret scan with negative control, CLI unauthenticated contract, and Worker production build all passed.

## Persistence and delivery contract

- Migration `0011_funny_madame_hydra.sql` creates `task_acceptance_items` with a task foreign key using `ON DELETE CASCADE` and a project/task/order lookup index.
- Every checklist mutation is project-scoped, uses both task and item revisions where applicable, advances the task polling revision, updates project freshness, and appends task activity without changing Kanban status.
- The D1 migration must be applied before deploying the Worker bundle that reads the new table.

## Production verification

- D1 migration `0011_funny_madame_hydra.sql` applied successfully; the remote migration list is empty afterward and `task_acceptance_items` is present in the production database.
- Worker version `93c032b7-1738-40a0-9220-4a05baad6b93` deployed successfully.
- Production smoke checks: Demo returned HTTP 200; unauthenticated checklist mutation returned HTTP 403.
