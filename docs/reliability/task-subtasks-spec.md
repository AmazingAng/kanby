# SPEC — Task subtasks and card splitting

- Tier: 3 — persistent hierarchy, concurrent writes, lifecycle mutation, and public task responses.
- Input: the user requested subtasks and card splitting on 2026-09-09.
- Spec approval: not separately obtained; this is an autonomous transcription of the request. Evidence must report the reduced confidence.
- Baseline: 12 files and 60 tests passed before this change.
- Setup plan:
  - Reuse the existing Vinext, React, dnd-kit, D1, Vitest, Drizzle, and manual mutation runner; add no dependency.
  - Stay on `codex/fix-kanby-reliability` and do not commit because the shared worktree contains extensive user-owned changes.
  - Add append-only migration `0010`; never rewrite migrations `0000`–`0009`.
  - Add `app/api/tasks/split/route.ts`, `lib/task-subtasks.ts`, and `tests/task-subtasks.test.ts`.
  - Extend `db/schema.ts`, `lib/db.ts`, `components/kanban-app.tsx`, the coverage configuration, mutation gate, and evidence report.

## Failure model

- Concurrent split requests duplicate children or lose one caller's update.
- A hostile request creates too many children, overlong titles, empty cards, or cross-project relationships.
- A child becomes its own parent or creates deeper/cyclic nesting.
- Parent progress becomes stale after a child moves, archives, restores, or is deleted.
- Archiving or deleting a parent silently destroys its children.
- Deleting a parent leaves dangling references or causes unrelated children to be promoted.
- Existing drag, autosave, archive, GitHub, Agent, and task-list API contracts regress.

## Scenarios

### Scenario: split an active top-level card into bounded children

Given an authenticated project member and an active top-level task at the expected revision, a same-origin JSON request containing 1–20 trimmed titles creates exactly those child tasks. Every title is non-empty and at most 160 characters. Children inherit the parent's owner, tag, and due date, begin in `ideas`, receive independent positions and revisions, and retain an explicit parent reference. The parent keeps its own title, status, and content.

### Scenario: split is atomic and revision guarded

Given two split requests using the same parent revision, only one succeeds. The loser receives a revision conflict and creates no child. A retry with the new revision may create another batch. Invalid, unauthenticated, cross-origin, foreign-project, archived, nested, or missing parents create nothing.

### Scenario: hierarchy is visible without hiding actionable cards

Every active child remains a normal board card that can be dragged, assigned, edited, archived, and linked independently. A child card and detail view identify its parent. A top-level parent card shows `shipped / active total`, and its detail view lists active children with controls to open a child or toggle it between `ideas` and `shipped`. A child cannot itself be split.

### Scenario: progress follows current active task state

Parent progress is derived from the current active task collection rather than stored counters. Moving a child to or from `shipped`, polling another member's change, archiving a child, restoring it, or deleting it updates the displayed progress without a counter backfill or drift risk.

### Scenario: lifecycle operations preserve child data

Archiving a parent does not archive its children. Active children keep a readable reference showing that the parent is archived. Permanently deleting an archived parent promotes only its direct children to top-level tasks and advances their revisions; deleting a child does not affect its parent or siblings.

### Scenario: existing contracts remain compatible

`GET /api/tasks` adds optional parent metadata but retains all existing fields. Existing task creation, edit/autosave, drag ordering, archive/restore, permanent deletion, attachment, GitHub, Agent, CLI, and three-second polling contracts remain valid. No nested task data is duplicated into stored JSON.

## Must NOT

- Do not allow more than one hierarchy level or infer relationships from titles.
- Do not automatically complete, reopen, archive, or delete a parent when children change.
- Do not cascade archive or permanent deletion from a parent to children.
- Do not hide child tasks from the board or give them a separate workflow model.
- Do not add a dependency, scheduler, queue, WebSocket, Durable Object, or R2 object.

## Revisions

- 2026-09-09: Initial autonomous transcription. One-level hierarchy, 20-item split batches, inherited owner/tag/due, `ideas` starting status, derived progress, and promotion-on-parent-delete are explicit implementation assumptions.
- 2026-09-09: The setup file list now names the pure `lib/task-subtasks.ts` projection helper used by both UI and executable progress tests; behavior is unchanged.
