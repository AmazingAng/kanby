# Kanby reliability hardening — evidence

- Run date: 2026-09-08 (Asia/Shanghai)
- Tier: 3
- Branch: `codex/fix-kanby-reliability`
- Validated source state: `a5351e150c70ae5b934aaf8080760375d81742eca9a77e22cac86ebc662ed93a` across 165 non-ignored files. The evidence file itself, build output, and coverage output are excluded by `tools/source-state.mjs`.
- Result: **GAUNTLET PASS — 11/11 layers**

## RED evidence

The first executable suite failed 10/10 scenarios. It reproduced the reviewed defects: wrong CLI exit code and credential overwrite, stale GitHub repository visibility, missing task revisions, runtime DDL, unbounded webhook handling, missing browser headers, non-atomic idempotency, idempotency-key payload reuse, and claim-owner bypass.

Further focused RED tests then proved that:

- GitHub installation ownership had no implementation.
- polling could replace the active editor draft and a failed save could close it;
- duplicate webhook deliveries both started processing;
- an eleventh attachment could be stored;
- the exact declared request-size boundary was not protected by the original test (discovered by a surviving mutant, then corrected with an explicit `Content-Length`).
- active tasks could not be distinguished from archived tasks because no lifecycle state existed, and permanent deletion had no owner, revision, dependent-row, or R2 cleanup contract.
- the first whole-card drag implementation always crossed a same-column target regardless of pointer half, ignored same-column blank-space drops, and shifted collision rectangles with its cross-column placeholder.

Two test-harness corrections were recorded without changing scenarios: the idempotency replay is allowed to receive the completed cached response, and attachment inserts were made sequential in the Node SQLite adapter because that adapter cannot model concurrent nested D1 transactions.

## GREEN and REFACTOR evidence

`npm run gauntlet` completed all declared layers:

| Layer                                        | Result                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Unit, integration, property, and concurrency | 10 files, 30 tests passed                                        |
| Enforced isolated-module coverage            | 93.18% statements, 86.20% branches, 100% functions, 97.29% lines |
| TypeScript                                   | `tsc --noEmit` passed                                            |
| Lint                                         | `oxlint` passed                                                  |
| Format                                       | 76 owned files checked, all passed                               |
| Mutation testing                             | 7/7 mutants killed                                               |
| Production dependency audit                  | 0 vulnerabilities                                                |
| Secret scan                                  | 163 files passed; negative control detected                      |
| CLI execution contract                       | missing credential exited 2                                      |
| Randomized suite                             | seed 9082026, all 30 passed                                      |
| Worker production build                      | all five Vinext build phases passed                              |

The killed mutants covered GitHub installation ownership, idempotency fingerprints, Agent claim ownership, editor-close fingerprints, the exact request-size boundary, optimistic task revisions, and active-versus-archived task selection. Property tests ran 400 generated content-length cases and 200 generated editor-state cases.

Refactoring retained the same executable evidence. Product code, not the generated `components/ui/**` baseline, is included in lint enforcement. The pure boundary/decision modules have isolated coverage thresholds because the inherited application arrived as untracked prior work, so Git could not provide an honest changed-line baseline; route, persistence, CLI, and concurrency behavior is instead enforced through integration and mutation tests.

The drag projection suite separately verifies upper/lower-half ordering, dropping on a same-column blank area, both cross-column insertion sides, payload preservation, center-based hit testing, keyboard direction, and explicit right-column selection from pointer coordinates. The UI now projects the task into the real target list during pointer/touch drag instead of injecting a layout-shifting placeholder. Its collision strategy resolves the pointer's column before considering cards in that column, so a middle-column card cannot steal a right-column drop. Mouse drag uses a distance threshold; touch drag uses a delayed activation with movement tolerance. Mandatory horizontal scroll snapping is disabled only while dragging so dnd-kit can auto-scroll through to the third column.

## Security and persistence evidence

- GitHub App setup verifies that a personal installation belongs to the signed-in user or that an organization installation is administered by that user. Organization authorization requires a fresh OAuth session with `read:org`.
- Installation synchronization marks inaccessible repositories inactive and removes stale project selections.
- Agent mutations atomically reserve idempotency keys, bind them to request fingerprints, and enforce active task claims at the database write boundary.
- Browser task writes use an `updatedAt` compare-and-swap revision; stale writes return 409 without overwriting the newer row.
- Archiving is a revision-guarded soft delete. Permanent deletion is owner-only, requires an archived row with the expected revision, atomically removes dependent D1 rows, and then best-effort removes attachment objects from R2.
- Webhook and attachment bodies are rejected before expensive parsing when their declared size exceeds the limit. Attachment row count is guarded in the insert itself.
- Runtime initialization performs no schema DDL. Append-only migration `0006_wooden_vin_gonzales.sql` owns the new repository activity flag.
- CSP, HSTS, `nosniff`, referrer, permissions, and frame-denial policies are emitted by `proxy.ts`.
- The CLI validates credentials before replacement and writes its configuration with mode 0600.
- React/Vinext/Vite and the Cloudflare toolchain were upgraded without forced peer resolution. The production audit has no findings; four moderate development-only advisories remain in legacy development transitive dependencies.

## Production evidence

- Remote D1 migrations through `0007_lyrical_aqueduct.sql` applied successfully to `kanby-db`; a follow-up migration listing reports no pending migrations.
- Worker version `b296b86a-b356-4a76-a7d0-2fb866ee9f30` deployed successfully to `https://kanby.0xaa.workers.dev` with the existing D1, R2, and secret bindings preserved.
- Live HTTP checks returned 200 for `/` and `/demo`, reported configured authentication, and included every required security header.
- In the authenticated production browser, the xAPI board loaded team avatars, task data, and GitHub activity. Clicking **设置** navigated to `/settings`; browser back restored the board; clicking a task opened the editable detail panel with the GitHub identity/avatar assignee, and closing it returned to the board.
- In the production Demo board, clicking the full-card activator opened details; keyboard-driven dnd-kit interaction moved the same card from **待开始** to **进行中**; archiving removed it from the board, the archive displayed it, and restore returned it. The final browser log contained no errors.
- After the drag projection follow-up deployed, the production Demo loaded the new bundle, full-card click still opened the editor, and the browser log contained no errors.
- The final production bundle exposed the three-column board as one labeled region. During an active drag its class changed from mandatory horizontal snapping to `snap-none`; cancellation restored mandatory snapping, and the browser log remained error-free.
- Every active task card now exposes a top-right quick-archive button above the full-card drag activator. It uses the same revision-guarded archive path as the detail panel without opening the editor or starting a drag. The cache-busted production Demo returned HTTP 200 after deployment.

## Residual operational notes

- `kanby.dev` is still the separate owner-only ChatGPT Site and therefore still uses the ChatGPT access gateway. This release intentionally targets the existing public Cloudflare Worker at `kanby.0xaa.workers.dev`.
- Users with an older session must sign in again before connecting an organization installation so the session contains the new organization-admin account IDs.
- At-most-once idempotency intentionally leaves an uncertain post-write failure pending rather than risking a duplicate mutation; clients should surface the 409 and use a new key only after reconciling task state.
- The worktree contained extensive pre-existing changes. They were preserved, the fix lives on the dedicated branch, and no commit was created.

---

# Unified task activity timeline — evidence

- Run date: 2026-09-09 (Asia/Shanghai)
- Tier: 3
- Approved spec: `docs/reliability/task-activity-spec.md`
- Validated source state: `bc410d09124870c1039c95fad23caca4ff0c96f0467dd4c03ccfe83e7419c61d` across 171 non-ignored files
- Result: **GAUNTLET PASS — 11/11 layers**

## RED evidence

Focused tests first failed for every new external behavior: unified task activity was unimplemented, browser mutations produced no events, Agent lifecycle writes produced no events, linked GitHub changes produced no task events, and branch Push routing did not exist. The malformed-cursor, malformed-metadata, no-progress claim, task-event cascade deletion, and CI delivery scenarios were added before the final gauntlet to close adversarial and lifecycle gaps.

## GREEN evidence

| Layer                                        | Result                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Unit, integration, property, and concurrency | 11 files, 44 tests passed                                        |
| Enforced isolated-module coverage            | 95.40% statements, 93.97% branches, 100% functions, 98.70% lines |
| Unified activity module coverage             | 97.67% statements, 98.14% branches, 100% functions, 100% lines   |
| TypeScript, lint, and format                 | All passed                                                       |
| Mutation testing                             | 10/10 mutants killed                                             |
| Production dependency audit                  | 0 vulnerabilities                                                |
| Secret scan                                  | 169 files passed; negative control detected                      |
| CLI unauthenticated contract                 | Passed                                                           |
| Randomized suite                             | Seed 9082026, all 44 passed                                      |
| Worker production build                      | All five Vinext phases passed                                    |

The new killed mutants specifically prove equal-timestamp activity pagination direction, active Agent lease filtering, and status-specific GitHub CI events. Existing mutants continued to prove authentication ownership, idempotency, request-size, optimistic-revision, archive, and editor-close invariants.

## Behavioral evidence

- Successful member create, semantic edit, cross-column move, archive, and restore operations atomically write authenticated activity; same-column sort remains quiet.
- Autosave events coalesce by editor session. Comments are same-origin, member-scoped, trimmed, bounded to 2,000 characters, and render as text.
- Agent claim, heartbeat, progress, release, GitHub link, and completion operations enter the same timeline. Repeated heartbeats coalesce and expired claims disappear from task cards. A new claim cannot display progress left by an older claim.
- GitHub Pull Request, Issue, matching linked-branch Push, and CI activity is task-specific and delivery-deduplicated. Unlinked branches do not pollute task timelines.
- Timeline pagination remains deterministic when timestamps collide, malformed cursors are rejected, and malformed legacy metadata is tolerated.
- Permanent task deletion removes dependent unified events.

## Production evidence

- Remote D1 migration `0008_tense_rick_jones.sql` applied to `kanby-db`; a follow-up listing reports no pending migrations.
- Worker version `a12f2c8a-bda8-4a06-8f12-6dc1eaf61d7b` deployed to `https://kanby.0xaa.workers.dev` with the existing D1, R2, and secrets preserved.
- Cache-busted `/demo?release=a12f2c8a` returned HTTP 200. The response retained CSP, HSTS, `nosniff`, and frame-denial headers; an unauthenticated task-activity read was rejected.

## Verification boundary

No independent subagent verification was performed because delegation was unavailable for this turn. No browser visual QA was added to the release gate; the executable UI contract is covered by build/type/lint checks and the live HTTP smoke test.

---

# Project-level GitHub automation — evidence

- Run date: 2026-09-09 (Asia/Shanghai)
- Tier: 3
- Autonomous spec transcription: `docs/reliability/github-automation-spec.md`
- Validated source state: `fb905a51b853279c79a617564f295c5640360e5d66b2da7ccdd4658dfa27c4df` across 178 non-ignored files
- Baseline: 11 files, 44 tests passed before this feature
- Result: **GAUNTLET PASS — 11/11 layers**

The user requested implementation directly, so the behavioral spec was transcribed and executed without a separate approval round. This reduces independent confirmation of the chosen defaults, but every rule is project-configurable and the assumptions are explicit in the spec.

## RED evidence

The first focused suite failed all eight initial automation scenarios because the settings schema, Issue import route, PR association, configurable transitions, and CI policy did not exist. Subsequent adversarial tests reproduced and then prevented five additional defects:

- the same short task reference could link tasks in two projects;
- permanent deletion left an Issue-import association behind;
- replacing an Issue's visible link with a PR caused a later Issue close to miss the task;
- a Pull Request opened from a fork could associate itself with a task;
- concurrent Issue-import clicks needed a database reservation to guarantee exactly one task.

## GREEN evidence

| Layer                                        | Result                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Unit, integration, property, and concurrency | 12 files, 60 tests passed                                        |
| Enforced isolated-module coverage            | 95.03% statements, 87.83% branches, 100% functions, 99.30% lines |
| GitHub automation module coverage            | 94.44% statements, 80.95% branches, 100% functions, 100% lines   |
| TypeScript, lint, and format                 | All passed                                                       |
| Mutation testing                             | 17/17 mutants killed                                             |
| Production dependency audit                  | 0 vulnerabilities                                                |
| Secret scan                                  | 176 files passed; negative control detected                      |
| CLI unauthenticated contract                 | Passed                                                           |
| Randomized suite                             | Seed 9082026, all 60 passed                                      |
| Worker production build                      | All five Vinext phases passed                                    |

The new killed mutants specifically prove exact PR marker parsing, reuse of an existing Issue link, project rule enforcement, completed-task backward-move protection, CI warning isolation, closed-Issue completion, and the same-repository boundary for automatic PR association.

## Behavioral and persistence evidence

- Issue import is member-scoped, same-origin, repository-scoped, rule-controlled, and idempotent under retries and concurrent double clicks. It uses the verified webhook snapshot rather than fetching private repository data again.
- PR association accepts only an explicit `Kanby-Task: <task-ref>` trailer or `kanby/<task-ref>-...` branch. References must resolve uniquely, archived tasks are excluded, the repository must be selected, and fork PRs cannot auto-associate.
- PR open/reopen/ready-for-review and merged-PR/closed-Issue transitions use separate per-project targets. `off` records activity without moving the task; closed unmerged PRs, synchronization, Push, and CI never change workflow status; completed tasks never move backwards.
- CI failures render a prominent task-card warning while preserving task status. Success clears it, and disabling the project rule clears existing warnings and suppresses later task-level CI changes.
- A fresh in-memory migration rehearsal applied every migration through `0009_aromatic_payback.sql`. Query-plan checks used `idx_github_issue_imports_item` for Issue lookup and `idx_github_project_repositories_repository` for project routing.

## Production evidence

- Remote D1 migration `0009_aromatic_payback.sql` applied successfully to `kanby-db`; a follow-up listing reports no pending migrations.
- Worker version `a73a378b-e2a5-4c87-8b81-c7e6891d8307` deployed to `https://kanby.0xaa.workers.dev` with the existing D1, R2, environment, and secret bindings preserved.
- Cache-busted `/demo?release=a73a378b` returned HTTP 200 with the existing security headers. An unauthenticated POST to `/api/github/issue-task` returned 403, proving the deployed route retained its authentication boundary.

## Verification boundary

Independent subagent review was not performed because the active collaboration policy prohibited delegation. Browser visual QA was not requested and therefore was not performed; executable UI checks, the production build, and live HTTP smoke tests cover this release boundary.

---

# Task subtasks and card splitting — evidence

- Run date: 2026-09-09 (Asia/Shanghai)
- Tier: 3
- Autonomous spec transcription: `docs/reliability/task-subtasks-spec.md`
- Validated source state: `00264029875fadf002542757f82575094fc9244c150b2c6b3837302a73f16ea8` across 184 non-ignored files
- Baseline: 12 files, 60 tests passed before this feature
- Result: **GAUNTLET PASS — 11/11 layers**

The user requested implementation directly, so the behavioral spec was transcribed and executed without a separate approval round. The one-level hierarchy, 20-card batch limit, inherited fields, `ideas` starting status, derived progress, and promotion-on-delete semantics are therefore explicit autonomous assumptions rather than independently approved product decisions.

## RED evidence

The initial focused suite failed all six scenarios: the split endpoint returned 501, concurrent calls were unguarded, hostile requests were not validated, progress always returned zero, and lifecycle tests had no hierarchy to preserve. After the browser path was green, the Agent API and CLI tests separately failed with an unsupported action and unknown command.

One deletion-response test passed immediately because that additive response had just been implemented. A throwaway mutant suppressed `promotedTasks`; the focused test then failed on the missing authoritative child revisions, after which the implementation was restored. During the first static pass, React purity lint rejected two demo-only `Date.now()` calls and the TypeScript lint required an explicit numeric sort comparator; both were corrected without weakening assertions.

## GREEN evidence

| Layer                                        | Result                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Unit, integration, property, and concurrency | 13 files, 72 tests passed                                        |
| Enforced isolated-module coverage            | 95.18% statements, 88.00% branches, 100% functions, 99.31% lines |
| TypeScript, lint, and format                 | All passed                                                       |
| Mutation testing                             | 22/22 mutants killed                                             |
| Production dependency audit                  | 0 vulnerabilities                                                |
| Secret scan                                  | 182 files passed; negative control detected                      |
| CLI unauthenticated contract                 | Passed                                                           |
| Randomized suite                             | Seed 9082026, all 72 passed                                      |
| Worker production build                      | All five Vinext phases passed                                    |

The five new persisted mutants prove parent-scoped progress, the one-level hierarchy guard, direct-child promotion on parent deletion, authoritative promoted revisions in the delete response, and Agent claim ownership for split operations. The separate throwaway mutant proved the new deletion-response assertion before it entered the permanent mutation set.

## Behavioral and persistence evidence

- An authenticated member can split an active top-level card into 1–20 children. The children inherit owner, tag, and due date, begin in `ideas`, remain ordinary draggable/editable cards, and receive parent metadata in browser and Agent responses.
- Parent progress is derived from active child states, so moves, quick completion, polling, archive, restore, and deletion cannot drift from a stored counter. Child cards identify their parent; parent details list children and provide open/complete controls.
- A parent revision compare-and-swap makes concurrent split batches atomic: one request succeeds and a stale competitor creates nothing. Cross-origin, unauthenticated, malformed, foreign-project, archived, nested, missing, and over-limit inputs create nothing.
- Archiving a parent leaves children active and labels the archived relationship. Permanently deleting the parent promotes direct active and archived children, advances their revisions, and returns authoritative task snapshots; deleting a child leaves its parent and siblings untouched.
- `kanby task split <ref> "<child>" ...` uses the existing project-scoped Agent Token and idempotency contract. A task claimed by another Agent cannot be split, and an idempotent replay returns the original child IDs without duplication.
- Every fresh test database rehearsed all migrations through `0010_shiny_zeigeist.sql`. `EXPLAIN QUERY PLAN` confirmed project-parent lookups use `idx_tasks_project_parent`.

## Production evidence

- Remote D1 migration `0010_shiny_zeigeist.sql` applied successfully to `kanby-db`; a follow-up listing reports no pending migrations.
- Worker version `bf44f508-4c0b-4381-a69a-436f1b34d68d` deployed to `https://kanby.0xaa.workers.dev` with existing D1, R2, environment, and secret bindings preserved.
- Cache-busted `/demo?release=bf44f508` returned HTTP 200 with the existing security headers. An unauthenticated browser split returned 403 and an unauthorized Agent task read returned the documented 401 JSON envelope.

## Verification boundary

Independent subagent review was not performed because the active collaboration policy prohibited delegation. Browser visual QA was not requested and therefore was not performed; executable projection/API/CLI checks, the production build, and live HTTP smoke tests cover this release boundary.
