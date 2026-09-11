# SPEC — Multi-assignee tasks

- Tier: 3 — persistent task ownership, authenticated writes, optimistic concurrency, migration, and Agent-facing public API
- Spec approval: not obtained (autonomous run requested by the user); EVIDENCE must record the confidence downgrade
- Setup plan:
  - Tools to install: none
  - Git isolation: continue on the existing `codex/fix-kanby-reliability` working branch because the active Kanby application is intentionally uncommitted/untracked and would be absent from a new worktree
  - Existing gauntlet: reuse `tools/gauntlet.sh`, `tools/mutants.mjs`, `tools/check-secrets.mjs`, and `tools/source-state.mjs`
  - Files added: `tests/task-assignees.test.ts`, append-only Drizzle migrations and metadata, and `docs/reliability/multi-assignee-tasks-evidence.md`
  - Files updated: `db/schema.ts`, `lib/db.ts`, `app/api/tasks/route.ts`, `app/api/v1/tasks/route.ts`, `components/kanban-app.tsx`, `packages/cli/bin/kanby.js`, `docs/AGENT_API.md`, and `tools/mutants.mjs`
  - New dependencies: none

## Failure model

- A task could be assigned to a non-member or a member from another project: validate every requested ID with a project-scoped membership query and reject the whole update.
- A partial write could change the primary owner without changing the assignee set: update the task row, assignee rows, project freshness, and activity in one D1 batch guarded by the same task revision.
- A failed concurrent request could share a millisecond timestamp with the winner and accidentally pass a timestamp-only guard: every assignee update stores a unique write revision, and all dependent statements require that exact revision.
- Two users could overwrite one another's assignee edits: preserve the existing `updatedAt` optimistic-concurrency contract and test that exactly one concurrent update wins.
- Existing tasks could lose their owner during migration: append schema-only migrations, then backfill each active and archived task's current owner exactly once with a bounded idempotent operation.
- Old clients and Agent integrations could break when `owner` changes shape: retain `owner` as the first assignee and add ordered `owners`; continue accepting legacy `ownerId` while supporting `ownerIds`.
- A card could grow unusably wide or overwhelm a 1–3 person product: require 1–3 unique assignees and render a compact avatar group.
- Child tasks could lose team context: split children inherit the complete ordered assignee set from their parent.
- Removing or deleting a task could leave assignee rows behind: task deletion must remove or cascade all assignee rows.

## Scenarios

1. **Read existing task ownership compatibly**
   - Given a migrated legacy task owned by Alice, task reads return `owner: Alice` and `owners: [Alice]` in web and Agent JSON.

2. **Assign multiple project members atomically**
   - Given Alice and Bob are project members and the task revision is current, updating with `ownerIds: [Alice, Bob]` returns both in that order, keeps Alice in legacy `owner`, advances `updatedAt`, and persists both rows.

3. **Reject invalid assignee sets**
   - Empty arrays, more than three IDs, duplicate IDs, malformed IDs, unknown users, and users outside the project return HTTP 400/404 without changing the task or assignee rows.

4. **Prevent lost assignee updates**
   - Two different assignee updates at the same task revision cannot both succeed; exactly one returns success and one returns HTTP 409.

5. **Create and split with complete ownership**
   - New tasks store the creator as their first assignee; splitting a task assigned to Alice and Bob creates children with both ordered assignees.

6. **Delete without orphans**
   - Permanently deleting an archived task removes its assignee rows; a direct task deletion with foreign keys enabled also cascades.

7. **Edit assignees in task details**
   - The task editor displays all current members as compact checkbox rows, allows selecting 1–3, prevents removing the final assignee, and autosaves through the existing task save queue.

8. **Summarize and filter cards**
   - Cards render every assignee in a compact avatar group, and filtering by any selected member includes tasks where that member is not the first assignee.

9. **Keep Demo representative**
   - At least one Demo card has two assignees and supports adding/removing assignees locally under the same 1–3 rule.

10. **Expose complete ownership to CLI and Agents**
    - `kanby task get/list` human output summarizes all assignee logins; `--json` and Agent API responses retain ordered `owners` plus legacy `owner`.

## Must NOT

- Multi-assignee edits must not change title, description, tag, due date, status, position, parent relationship, attachments, acceptance criteria, GitHub link, Agent claim, or archive state.
- A failed validation or stale revision must not partially replace assignees.
- Existing `owner` and `ownerId` compatibility must not be removed.
- Applied migrations must remain immutable; only a new migration may be added.
- No browser storage, new dependency, credential, or runtime capability may be introduced.

## Revisions

- Initial autonomous specification.
- Sites persistence rules require generated migrations to remain schema-only. The legacy-owner backfill will therefore be a separate bounded, idempotent `INSERT … SELECT … WHERE NOT EXISTS` operation run and verified before the Worker deploy; reads also retain a legacy fallback so an interrupted backfill cannot make ownership disappear.
- The first generated migration added the assignment relation. A second append-only migration adds the per-write assignment revision needed to prove dependent D1 batch statements belong to the task update that actually won optimistic concurrency.
