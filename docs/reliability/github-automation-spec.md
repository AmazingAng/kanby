# SPEC — Project-level GitHub automation

- Tier: 3 — verified external webhooks perform concurrent persistent mutations.
- Input: the user explicitly requested the five automation behaviors and asked to plan and complete them on 2026-09-09.
- Spec approval: not separately obtained; this is an autonomous transcription of that request. Evidence must claim reduced confidence accordingly.
- Baseline: 11 files and 44 tests passed before this change.
- Setup plan:
  - Tools and dependencies: none; reuse D1, Vinext, React, Vitest, the GitHub App, and the existing manual mutation runner.
  - Git: remain on `codex/fix-kanby-reliability`; do not commit because the shared worktree contains extensive user-owned changes.
  - Add append-only Drizzle migration `0009`; never rewrite migrations `0000`–`0008`.
  - Add `lib/github-automation.ts`, `app/api/github/issue-task/route.ts`, and `tests/github-automation.test.ts`.
  - Extend the GitHub persistence/webhook route, GitHub settings route, board/settings UI, Kanby Agent skill, coverage configuration, mutation gate, and evidence report.

## Failure model

- A duplicate webhook or double click creates duplicate tasks or repeated state changes.
- A Pull Request accidentally links a similarly named task, a task in another project, an archived task, or a task whose repository is not selected.
- A disabled project rule still changes a task or exposes a CI warning.
- A project member changes owner-only automation settings.
- Opening or synchronizing a PR incorrectly moves a completed task backwards.
- Closing an unmerged PR marks a task complete.
- CI failure changes task workflow status or remains stuck after success/rule disablement.
- One project's rules leak into another project connected to the same repository.
- Migration or webhook rollout breaks existing GitHub links and Agent/CLI contracts.

## Scenarios

### Scenario: project automation settings are explicit and owner-controlled

Given a project with no saved automation row, GitHub settings return defaults: Issue import on, PR auto-link on, PR-open target `building`, completion target `shipped`, and CI warning on. The owner can independently disable Issue import, disable PR auto-link, set either target to `ideas`, `building`, `shipped`, or `off`, and disable CI warnings. A member cannot change these values. Disabling CI warnings clears existing card CI statuses for that project.

### Scenario: one click imports an Issue exactly once

Given an `issues` event from a repository selected for the project, a project member can click “创建任务”. Kanby creates one `ideas` task owned by that member, copies the Issue title and URL, links the Issue, records authenticated activity, and returns the same task for retries or concurrent double clicks. Non-Issue events, foreign events, disabled Issue import, unauthenticated/cross-origin requests, and unselected repositories create nothing.

### Scenario: an Agent-authored Pull Request automatically links

Given an active task and a selected repository with PR auto-link enabled, a Pull Request opened with the exact trailer `Kanby-Task: <full task id or unique 8+ character ref>` in its body, or a `kanby/<ref>-...` branch, replaces the task's current GitHub link with that PR. The reference match is project-scoped, case-insensitive, unique, and excludes archived tasks. Missing, ambiguous, short, malformed, disabled, or cross-project references do not link. The Kanby Agent skill tells coding agents to add the trailer when creating a PR.

### Scenario: PR opening follows the configured target

Given a task linked to a Pull Request, `opened`, `reopened`, or `ready_for_review` moves an active non-`shipped` task to the project's configured PR-open target. `synchronize` and Push events never move it. `off` leaves status unchanged, and a completed task is never moved backwards. Replayed deliveries remain idempotent.

### Scenario: merged PR or closed Issue follows the completion target

Given a linked task, a merged Pull Request or closed Issue moves the active task to the configured completion target. A closed unmerged Pull Request does not. `off` only records/synchronizes GitHub metadata. One project's target does not affect another project connected to the same repository.

### Scenario: CI failure is prominent but workflow-neutral

Given a task linked to a Pull Request branch, a completed failing workflow stores its conclusion and renders a prominent red “CI 失败” card warning without changing task status. A later successful workflow clears the failure warning. With CI warnings disabled, workflow activity remains in the project feed but task status and card CI state are untouched/cleared.

### Scenario: existing contracts remain compatible

Existing GitHub repository selection payloads, task links, GitHub activity, Agent APIs, CLI commands, task autosave, dnd-kit behavior, and three-second board polling remain valid. New response fields are additive.

## Must NOT

- Do not call GitHub during Issue import; use the already verified webhook snapshot.
- Do not infer task association from arbitrary numbers or fuzzy title similarity.
- Do not create a task automatically merely because an Issue webhook arrived.
- Do not allow CI to change `ideas`, `building`, or `shipped`.
- Do not install a scheduler, queue, WebSocket, Durable Object, MCP server, or new dependency.
- Do not expose private repository content beyond the Issue/PR metadata already delivered and selected for this project.

## Revisions

- 2026-09-09: Initial autonomous transcription. Defaults and the explicit PR trailer/branch convention are implementation assumptions needed to make automatic linking deterministic.
- 2026-09-09: Adversarial review tightened PR auto-linking to same-repository branches only. Pull Requests from forks may still appear in the project feed, but cannot mutate a task association or workflow state until explicitly linked.
