# SPEC — Task acceptance checklist

- Tier: 3 — persistent task data, concurrent edits, authenticated API, and Agent-facing task output
- Spec approval: not obtained (autonomous run requested by the user); the evidence report must record the corresponding confidence downgrade
- Setup plan:
  - Tools to install: none
  - Git isolation: continue on the existing `codex/fix-kanby-reliability` branch because the active Kanby implementation is intentionally uncommitted/untracked and would be absent from a new worktree
  - Existing gauntlet: reuse `tools/gauntlet.sh`, `tools/mutants.mjs`, `tools/check-secrets.mjs`, and `tools/source-state.mjs`
  - Files added: `app/api/task-checklist/route.ts`, `tests/task-checklist.test.ts`, one append-only Drizzle migration and metadata, and `docs/reliability/task-acceptance-checklist-evidence.md`
  - Files updated: `db/schema.ts`, `lib/db.ts`, `components/kanban-app.tsx`, `packages/cli/bin/kanby.js`, and `docs/AGENT_API.md`
  - New dependencies: none

## Failure model

- A checklist item could be written to another project or task: catch with authenticated cross-project route tests and project-scoped SQL predicates.
- Two members could overwrite the same item: require the item's current `updatedAt` for update/delete and return HTTP 409 on a stale revision; catch with a concurrency test.
- Unbounded or hostile input could grow D1 or break the UI: reject blank text, text over 240 characters, unknown fields, and a 21st active item.
- Checklist changes could be invisible to polling clients: every mutation must advance the parent task revision and the returned task payload must include the authoritative checklist.
- Deleting a task could orphan checklist rows: use a foreign key with cascade and test deletion behavior.
- Checking acceptance criteria could accidentally complete the task: assert task status never changes as a checklist side effect.
- CLI/Agent consumers could miss acceptance criteria: task JSON and human-readable `task get` output must expose ordered checklist state.

## Scenarios

1. **Create an acceptance criterion**
   - Given an authenticated project member and a current task revision, when they add `登录后能创建项目`, then the API returns 201 with an unchecked item at the next position and a newer task revision.

2. **Reject invalid or unauthorized creation**
   - Blank text, text over 240 characters, cross-origin requests, unauthenticated requests, foreign-project tasks, stale task revisions, and a 21st item must be rejected without inserting a row.

3. **Toggle and rename a criterion**
   - Given an item's current revision, a member can mark it complete or replace its text; the API returns the authoritative updated item and newer task revision.

4. **Prevent lost updates**
   - Two updates using the same item revision may not both succeed: exactly one returns 200 and the other returns 409.

5. **Delete a criterion**
   - Given its current item revision, deletion removes only that project/task/item tuple, advances the task revision, and stale or foreign deletion is rejected.

6. **Return ordered criteria with every task**
   - Web and Agent task reads return `acceptanceCriteria` ordered by position then creation time; deleting the task cascades its criteria.

7. **Record activity without changing task status**
   - Create, rename, complete/reopen, and delete write concise activity events while the task's Kanban status remains unchanged.

8. **Use the checklist in the task editor**
   - The editor always exposes an acceptance checklist with add-on-Enter, checkbox toggle, inline rename, delete, empty state, loading state, and `done/total` progress.

9. **Summarize acceptance on cards**
   - A card with criteria shows a compact checklist icon and `done/total`; a fully checked list has a distinct completed treatment; a card with no criteria gains no visual clutter.

10. **Keep Demo useful**
    - Demo tasks include representative criteria and support local add, toggle, rename, and delete without network requests.

11. **Expose criteria to the CLI**

- `kanby task get <ref>` prints each criterion as `[ ]` or `[x]`, while `--json` preserves the structured array.

12. **Treat the starter description as a placeholder**

- Opening or focusing the description of a newly created task clears `刚刚创建，补充一点上下文吧`; real user-authored descriptions remain intact.

13. **Keep same-column families together**

- In a column containing both a parent and its children, the children render immediately after the parent with a visible left offset and hierarchy rail. Children in a different status column keep their own column placement.

## Must NOT

- Checklist mutations must not change task title, owner, status, subtask relationship, attachments, GitHub link, or Agent claim.
- A stale client must not silently overwrite or delete a newer item.
- The migration must not modify an already-applied migration.
- The UI must not depend on browser storage for authoritative checklist state.
- No new package, credential, or runtime capability may be introduced.

## Revisions

- Initial autonomous specification.
- All update and delete mutations also require the current parent-task revision. This strengthens the original item-only precondition so checklist rows, task polling revisions, and activity events advance atomically when a task and one of its acceptance criteria are edited concurrently.
- Added the requested default-description clearing behavior and same-column parent/child grouping as explicit UI regressions.
