# SPEC — Kanby reliability hardening

- Tier: 3 — authentication, private repository access, persistent shared data, concurrency, and public Agent API.
- Spec approval: not obtained (autonomous run); the user requested the reviewed findings be fixed.
- Setup plan:
  - Tools to install: Vitest 5.0.0, `@vitest/coverage-v8` 5.0.0, and fast-check 4.9.0.
  - Git: create `codex/fix-kanby-reliability` from the current dirty `main` checkout. Preserve every pre-existing tracked and untracked change; do not commit without a separate request.
  - Gauntlet files: `tests/**/*.test.ts`, `vitest.config.ts`, `tools/gauntlet.sh`, `tools/mutants.mjs`, `docs/reliability/kanby-hardening-evidence.md`.
  - Runtime/toolchain dependency upgrades: React, React DOM, and React Server DOM Webpack 19.2.8; Vinext 1.0.0-beta.9; Vite 8.2.2; `@vitejs/plugin-rsc` 0.5.34; Cloudflare Vite plugin 1.54.5; Wrangler 4.129.1; Workers types 5.20260908.1. These are audit/compatibility remediations; the RSC plugin is Vinext beta.9’s declared peer requirement.
  - New test-only dependencies: Vitest is the test runner, coverage-v8 enforces executable coverage, and fast-check exercises parser/state invariants with generated hostile inputs.

## Failure model

- A Kanby owner binds another customer’s GitHub App installation and reads private repository metadata.
- Two retries with one idempotency key both mutate state, or a crash after the mutation makes a later retry duplicate it.
- A second Agent Token edits or completes a task claimed by another token.
- A failed autosave closes the editor and discards the only copy of the user’s draft.
- A stale browser or Agent snapshot silently overwrites a newer task edit.
- A GitHub installation permission reduction leaves revoked private repositories visible or selected.
- Worker cold starts execute schema DDL that competes with migration ownership.
- Large unauthenticated webhook or multipart requests exhaust the Worker’s 128 MB isolate.
- A vulnerable dependency permits avoidable denial of service.
- CLI authentication failures violate the documented exit-code contract or overwrite a working credential with an invalid token.

## Scenarios

1. **GitHub installation ownership**
   - Given a project owner starts a GitHub connection, when setup returns an installation whose account the authenticated GitHub user cannot administer, then the callback rejects it and stores no installation or repository.
   - Given the GitHub user can administer the installation account, the callback accepts it.

2. **Atomic idempotency reservation**
   - Given two concurrent mutations use the same token, key, operation, and request fingerprint, exactly one receives the right to execute and the other receives either the completed cached response or an in-progress conflict without running the mutation.
   - Reusing the same key with another operation or request fingerprint returns HTTP 409.
   - Validation failures before a write release their reservation; an uncertain failure after execution starts remains pending, preferring a visible conflict over a duplicate write.

3. **Claim ownership**
   - Claim acquisition remains exclusive.
   - `update`, `progress`, `link`, and `complete` reject HTTP 409 when another unexpired claim exists.
   - An unclaimed task or the token holding the claim may mutate it.

4. **Conflict-safe autosave**
   - Task responses carry an `updatedAt` revision.
   - Updating with the current revision succeeds; updating with a stale revision returns HTTP 409 and preserves the newer database row.
   - Closing the task editor keeps the draft visible until save succeeds; a failed save keeps/reopens the draft with an actionable retry message.
   - Poll refresh does not replace the task currently being edited with stale remote state.

5. **GitHub permission reduction**
   - Synchronizing an installation removes project selections and hides cached repositories no longer returned by GitHub, while preserving linked history and repositories still accessible.

6. **Migration ownership**
   - Runtime `ensureSchema` performs no `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, or production backfill.
   - All required schema and indexes exist in append-only Drizzle migrations.

7. **Bounded request bodies**
   - Webhooks reject a declared body larger than 1 MB before buffering it.
   - Attachment requests require a finite positive `Content-Length` within the multipart budget before calling `formData()`.

8. **Dependency and browser hardening**
   - The production build uses the audited remediation dependency versions.
   - Every HTML response includes HSTS, CSP/frame-ancestors, nosniff, referrer, and permissions policies without breaking existing navigation or GitHub avatars/images.

9. **CLI credential contract**
   - Missing or rejected credentials exit 2.
   - Login validates the token before replacing a saved credential, and the resulting config file is mode 0600.

10. **Compatibility and deployability**
    - Existing browser and Agent JSON fields remain available; new revision/idempotency fields are additive.
    - Anonymous browser/Agent/attachment requests and unsigned webhooks remain rejected.
    - TypeScript, production Worker build, focused lint/format, tests, changed-code coverage, property tests, mutation tests, audit, secret scan, and a realistic CLI execution all pass.

11. **Card interaction and lifecycle**
    - A short click anywhere on a task card opens details, while a pointer move past dnd-kit’s activation distance drags the same card across columns.
    - Archiving removes a task from the active board without deleting its data; the archive panel can restore it.
    - Permanent deletion is available only to project owners, requires explicit browser confirmation, removes dependent D1 rows, and best-effort cleans the task’s R2 objects.

## Must NOT

- Do not rotate credentials, create application records, or call GitHub mutation APIs during verification. After every gate passes, publish through the existing Cloudflare/Sites path and apply only the new append-only schema migration required by this fix.
- Do not expose GitHub OAuth/App secrets, webhook secrets, private keys, session secrets, or Agent Tokens in source, logs, tests, or evidence.
- Do not rewrite already-applied migration files; append a new migration when schema changes are required.
- Do not remove claim, idempotency, task, attachment, GitHub, project, or CLI capabilities.
- Do not overwrite or discard unrelated pre-existing dirty-worktree changes.
- Do not permanently delete an active task in one step; permanent deletion is owner-only and only available from the archive.
- Do not claim browser interaction, D1 production concurrency, or deployment evidence that was not executed.

## Revisions

- Initial autonomous specification derived from the 2026-09-08 evidence-first review.
- Before implementation, clarified idempotency’s crash policy as at-most-once (a stranded pending key is safer than a duplicate mutation), retained inaccessible GitHub repository history as hidden inactive metadata, and aligned the delivery plan with the project’s required hosted Site lifecycle.
- Setup revision: Vinext beta.9 rejected the existing RSC plugin through npm peer resolution, so `@vitejs/plugin-rsc` 0.5.34 was added as its exact declared compatible peer instead of forcing an inconsistent install.
- RED correction: the initial concurrent-idempotency test incorrectly required the replay caller to fail even though the scenario explicitly permits a completed cached response. The assertion now requires one database mutation and one response identity across all successful callers; this matches the unchanged scenario and is recorded for auditability.
- Coverage clarification: because the inherited worktree contains the entire application as untracked prior work, Git cannot calculate an honest changed-line baseline. The enforced coverage gate therefore isolates the new pure decision/boundary modules at 90/90/90/85, while concurrency, persistence, routes, and CLI behavior remain enforced by integration and mutation gates.
- Audit revision: the current Cloudflare plugin/toolchain still pulled high-severity `undici`, `sharp`, and `ws` advisories. The compatible current Cloudflare Vite plugin, Wrangler, and Workers type packages were upgraded together rather than forcing an inconsistent dependency tree; only development-only moderate advisories remain outside the production audit gate.
- Product follow-up: after the initial hardening deployment, the user requested whole-card dragging and task archive/delete. The same Tier 3 gauntlet remains mandatory because permanent deletion extends the data-loss boundary; archive is reversible and deletion is restricted to owners from the archive view.
