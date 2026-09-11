# SPEC — Unified task activity timeline

- Tier: 3 — concurrent persistent writes and the public Agent API are in scope.
- Approval: the user approved the preceding architecture and scope with “好的 开始开发吧” on 2026-09-09.
- Setup plan:
  - Tools to install: none.
  - Git: continue on the existing `codex/fix-kanby-reliability` branch without commits because the shared worktree already contains extensive user-owned changes.
  - Gauntlet files: reuse `tools/gauntlet.sh`, `tools/mutants.mjs`, `tools/check-secrets.mjs`, and `tools/source-state.mjs`; add `tests/task-activity.test.ts` and update the persisted gauntlet only if the new invariants require it.
  - Product files: add an append-only Drizzle migration and `lib/task-activity.ts`; add authenticated browser activity/comment endpoints; integrate existing browser task writes, Agent writes, GitHub webhooks, task DTOs, and the task detail/card UI.
  - New dependencies: none; the existing D1, React, Vinext, Vitest, and UI dependencies cover the feature.

## Failure model

- A task mutation succeeds but its activity entry is lost, or an activity entry is written for a failed mutation.
- retries, autosave, Webhook delivery, or Agent heartbeat create duplicate/noisy entries.
- a member can read or comment on a task in another project.
- a forged browser payload can choose its displayed actor.
- unrelated repository Push events pollute task activity.
- expired Agent claims continue to appear active on cards.
- pagination skips or duplicates records with equal timestamps.
- hostile comment content becomes executable markup or grows without bound.
- schema rollout breaks the already deployed Worker or rewrites an applied migration.

## Scenarios

### Scenario: browser task changes produce authenticated activity

Given an authenticated project member and an active task, when that member creates, semantically updates, moves across columns, archives, or restores the task, then the successful mutation records one task event whose actor is derived from the session. A same-column reorder does not add activity.

### Scenario: autosave activity is coalesced

Given several task updates from one open editor session, when they share the same valid edit-session identifier, then the activity feed contains one coalesced `task.updated` event for that session while the task retains every successful field update.

### Scenario: comments are project-scoped and bounded

Given a project member, when they post a trimmed comment containing 1–2,000 characters, then one `comment.created` event is returned with their server-derived identity and literal text. Empty, oversized, cross-project, non-member, or cross-origin writes are rejected without inserting an event.

### Scenario: activity pagination is deterministic

Given more than 20 task events including events with the same timestamp, when a member requests pages using the returned cursor, then each event appears exactly once in newest-first order and the member cannot read another project's task.

### Scenario: Agent activity is unified without heartbeat spam

Given a valid project Agent Token, when it claims, heartbeats, reports progress, releases, links GitHub work, or completes a task, then those operations appear in the unified task activity. Repeated heartbeats for the same claim coalesce into one heartbeat event, and an expired claim is not returned as active card state.

### Scenario: GitHub activity is task-specific and idempotent

Given a task linked to a selected Issue or Pull Request, when a verified GitHub delivery changes that item or its branch CI state, then a task event is recorded with the GitHub actor and URL. Replaying the delivery does not duplicate the event, and unlinked repository activity remains only in the project feed.

### Scenario: task details and cards expose current activity

Given an authenticated board, when a task detail opens, then it shows a paginated mixed timeline and a comment composer, refreshes new activity while visible, and preserves the existing autosave behavior. A task with an unexpired Agent claim shows the Agent name and latest progress on its card; a task without one keeps its existing compact layout.

### Scenario: existing public contracts remain compatible

Given an existing Kanby CLI or browser client, when it uses the current task endpoints and payloads without the new optional fields, then its behavior and response envelope remain valid.

## Must NOT

- Do not add WebSockets, Durable Objects, MCP, notifications, mentions, comment editing, or comment attachments in this release.
- Do not expose Agent tokens, GitHub secrets, private repository contents, or client-supplied actor snapshots.
- Do not rewrite migrations `0000` through `0007`; append one new migration only.
- Do not log every character-level autosave, same-column sort, poll, or repeated heartbeat as a new visible event.
- Do not change the three-column workflow, full-card dnd-kit behavior, archive semantics, or 3-second visibility-aware polling contract.

## Revisions

- 2026-09-09: Initial executable transcription of the user-approved activity-timeline design. The MVP keeps comments immutable and uses the existing polling model, matching the approved scope.
