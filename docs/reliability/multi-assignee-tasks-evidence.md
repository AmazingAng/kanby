# EVIDENCE — Multi-assignee tasks

## Outcome

- Cards support an ordered set of 1–3 current project members.
- Browser and Agent writes accept `ownerIds`; legacy `ownerId` remains accepted.
- Task JSON exposes ordered `owners` and retains the first assignee as legacy `owner`.
- Cards render an avatar group, the member filter matches every assignee, and Demo data exercises two owners.
- Split children inherit the complete assignment set. Task deletion explicitly removes assignment rows and the foreign key also cascades.
- Assignment writes use optimistic task revisions plus a unique `assignee_revision`, so dependent D1 batch statements cannot be executed on behalf of a losing concurrent request.

## RED evidence

- The first route test sent `ownerIds: [Alice, Bob]` and observed HTTP 400 before the API and persistence implementation existed.
- The first UI-helper and CLI expectations failed before ordered owner fallback, secondary-member filtering, bounded toggling, and multi-owner CLI formatting were implemented.

## Verification

- Targeted behavior: `npx vitest run tests/task-assignees.test.ts tests/task-assignee-ui.test.ts tests/cli.test.ts` — 13/13 passed.
- Full suite: `npm test` — 91/91 passed across 16 files.
- Shuffled suite: seed `9082026` — 91/91 passed.
- TypeScript: `npx tsc --noEmit` — passed.
- Lint: `npm run lint` — passed.
- Format: `npm run format:check` — passed.
- Production dependency audit: zero vulnerabilities.
- Secret scan: 199 files passed; negative control detected.
- Worker production build: passed.
- Full gauntlet: 11/11 layers passed.
- Coverage: 95.54% statements, 89.44% branches, 100% functions, 99.43% lines for the configured reliability surface.
- Mutation score: 30/30 killed. New mutations cover the maximum-assignee boundary, unique concurrent-write identity, and filtering by a non-primary assignee.
- Pre-evidence source-state digest: `8fceba34c3d9840ca63eb471bf754ac0e514ea1398b46b148bcbe41a74617bb7` across 201 tracked/unignored source files.

## Migration and production

- Applied generated schema-only migrations `0012_lovely_vermin.sql` and `0013_dear_ravenous.sql` to remote D1 `kanby-db`.
- Ran the bounded idempotent legacy-owner backfill from `tools/backfill-task-assignees.sql`.
- Verification after backfill: 25 tasks, 25 assignment rows, 0 tasks missing assignments.
- D1 bookmark after backfill: `000000c6-0000010c-000050e2-ce1a545fc1343bc155e08f65401f5f46`.
- Deployed Worker version: `7f3869f2-df20-4293-82f7-83d788446aee`.

## Confidence and residual risk

- Confidence is high from executable API, persistence, concurrency, compatibility, CLI, migration, property-suite, and mutation evidence.
- Confidence is downgraded because the Tier 3 specification was not reviewed before autonomous implementation.
- No interactive browser test was performed; UI confidence comes from pure behavior tests, TypeScript, lint, and the production Worker build. A signed-in visual pass remains useful for layout polish, but is not required for the persistence contract.
