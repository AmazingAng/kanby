# SPEC — Kanby AGPL public release

- Tier: 3 — the release exposes authentication, private GitHub repository access, shared project data, attachments, and the public Agent API to outside operators.
- Spec approval: not obtained (autonomous run); the user asked to organize and publish the main project.
- Setup plan:
  - Tools to install: none; reuse the pinned npm toolchain, `gh`, and the repository gauntlet.
  - Git: work on the existing `codex/fix-kanby-reliability` branch. A clean worktree cannot represent the large set of existing uncommitted Kanby features, so preserve them in place, scan before committing, then create release commits only after the gauntlet passes.
  - Files added or materially updated for release: `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/workflows/ci.yml`, `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `.env.example`, `.gitignore`, `package.json`, `docs/CLOUDFLARE_DEPLOY.md`, `tests/public-release.test.ts`, `tools/check-secrets.mjs`, `tools/source-state.mjs`, `tools/gauntlet.sh`, and `docs/reliability/public-release-evidence.md`.
  - New dependencies: none.

## Failure model

- A credential, private key, Agent Token, installation token, or real identifier is published from the worktree or Git history.
- A clone cannot build because required bindings, environment variables, migrations, or Node versions are undocumented.
- The repository claims AGPL while missing the license text or while package metadata says something else.
- CI passes without executing tests, types, lint, format, secret scanning, and a production Worker build.
- Public contribution or vulnerability reports have no safe process.
- Existing product behavior, migrations, CLI compatibility, or deployment configuration regresses during packaging.
- Publishing accidentally overwrites an unrelated remote or makes the wrong GitHub repository public.

## Scenarios

1. **License consistency**
   - Given a fresh clone, the root license contains GNU AGPL version 3 and package metadata reports `AGPL-3.0-only`.
   - The independently distributed CLI remains MIT licensed and is clearly identified as such.

2. **Secret-safe source and history**
   - Given tracked and untracked release files plus every reachable Git commit, the scanner reports only filenames and locations, never secret values, and exits nonzero for synthetic GitHub, Kanby, assigned-secret, and private-key controls.
   - `.env.example` contains placeholders only; private environment files, PEM files, Worker state, builds, and coverage remain ignored.

3. **Reproducible onboarding**
   - Given a new contributor with Node 22, the README explains local setup, D1/R2 bindings, migrations, GitHub OAuth/App configuration, test commands, architecture, and project status without requiring production credentials.

4. **Public maintenance surface**
   - Given a contributor or security reporter, contribution rules, conduct expectations, issue/PR templates, and a private vulnerability-reporting path are discoverable.

5. **Release CI and build**
   - Given a pull request or push to `main`, CI installs from the lockfile and runs the repository gauntlet.
   - Given the final release tree, unit/integration/property/concurrency tests, coverage gates, TypeScript, lint, formatting, mutation checks, production dependency audit, secret scan, randomized tests, Worker build, and schedule validation pass.

6. **Exact publication target**
   - Given no existing git remote, publishing creates or connects only `AmazingAng/kanby`, with public visibility, an AGPL license declaration, description, homepage, and repository topics.
   - The release branch is pushed only after all preceding scenarios pass; the production service and secrets are not changed by repository publication.

## Must NOT

- Do not print, commit, or upload secret values, `.env` files, PEM files, GitHub installation tokens, session secrets, or Agent Tokens.
- Do not silently rewrite published Git history; if a historical secret is detected, stop publication and require rotation plus an explicit history-cleaning decision.
- Do not change product behavior or database schema merely to package the repository.
- Do not remove existing uncommitted feature work, migrations, tests, CLI, or skill files.
- Do not deploy the Worker, rotate credentials, or mutate GitHub App/OAuth configuration as part of this repository release.
- Do not create or publish to a repository whose owner/name differs from the resolved target.

## Revisions

- Initial autonomous specification created before release-file changes on 2026-09-11.
- Isolation exception recorded: the current dirty branch is the only source state containing the product requested for publication; creating a worktree from HEAD would omit it.
- Test harness added to the setup list before implementation because historical-secret detection requires a disposable Git repository fixture.
- Source-state hashing now excludes all evidence reports so the final report can name a stable hash without creating a self-referential digest.
- CI action references were pinned to immutable commit SHAs to reduce tag-movement supply-chain risk.
- Supply-chain revision: the full audit exposed high-severity findings in the Cloudflare development runtime. `@cloudflare/vite-plugin` moved from 1.54.5 to 1.54.7, Wrangler from 4.129.1 to 4.131.0, and Workers types from 5.20260908.1 to 5.20260911.1 as a compatible set. No dependency was added; the remaining four moderate findings are confined to Drizzle Kit's local development path and npm's suggested "fix" is an incompatible downgrade.
- Publication target review found that `AmazingAng/kanby` already contains an unrelated 2025 implementation and a tracked `.env` in its reachable history. The safety invariant therefore blocks making that repository public or force-pushing it without a separate destination/history decision.
- Mutation coverage was extended with history-scan, redaction, and repository-boundary mutants so the release scanner's new controls are exercised rather than relying only on a passing happy path.
- Post-publication CI revision: the first successful run warned that the v4 JavaScript action runtime was deprecated. Checkout and setup-node were moved to the current official v7 releases, still pinned to immutable commit SHAs, before tagging the release.
