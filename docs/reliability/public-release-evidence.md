# Kanby AGPL public release — evidence

- Run date: 2026-09-11 (Asia/Shanghai)
- Tier: 3
- Spec approval: not obtained (autonomous run); confidence is downgraded and `public-release-spec.md` is the review artifact.
- Branch: `codex/fix-kanby-reliability`
- Validated source state: `f6d6d9721d4cab1da67abb586532a597c044da3a168b7109a2f710ae3d23f253` across 227 non-ignored, non-evidence files. `tools/source-state.mjs` excludes generated output and `*-evidence.md` reports.
- Entry point: `npm run gauntlet`
- Result: **GAUNTLET PASS — 12/12 layers; clean public repository created without exposing or overwriting the legacy repository**

## Spec-to-test mapping

| Scenario                            | Evidence                                                                                                                             | Status |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| License consistency                 | `tests/public-release.test.ts` — root package and full AGPL text; `packages/cli/LICENSE` remains MIT                                 | Pass   |
| Secret-safe source and history      | `tests/public-release.test.ts` — deleted historical secret, uncommitted private key, redacted output; `node tools/check-secrets.mjs` | Pass   |
| Reproducible onboarding             | `tests/public-release.test.ts` — required README sections and tracked placeholder environment; Worker build and Drizzle check        | Pass   |
| Public maintenance surface          | `tests/public-release.test.ts`; contribution, conduct, security, issue, and PR documents                                             | Pass   |
| Release CI and build                | CI workflow invokes the same gauntlet from a full-history checkout; local gauntlet result below                                      | Pass   |
| Exact publication target            | GitHub repository metadata, remote reference inspection, and successful clean push                                                   | Pass   |
| Must not expose credentials         | Worktree plus reachable-history scan and three release-scanner mutants                                                               | Pass   |
| Must not regress the product        | 24 test files, production build, types, lint, format, migration check                                                                | Pass   |
| Must not overwrite the wrong remote | Legacy repository renamed and kept private; new repository received a normal non-force push                                          | Pass   |

## RED evidence

The focused release suite initially failed 4/4 tests: there was no root license, no README or public maintenance documentation, the secret scanner ignored its `--repo` target, and it did not inspect reachable Git history. After those behaviors were implemented, an additional test failed because `.gitignore` accidentally excluded `.env.example`; the template is now explicitly included while real `.env*`, PEM, key, Worker-state, build, and coverage files remain ignored.

The full dependency audit then exposed four high-severity findings in the Cloudflare development runtime. Compatible upgrades to the Cloudflare Vite plugin, Wrangler, and Workers types removed all high findings. Four moderate Drizzle Kit development-path findings remain; npm proposes an incompatible Drizzle Kit downgrade, so they are documented instead of forcing a broken toolchain.

## Gauntlet — final fresh run

| Layer                                    | Command                                             | Result                                                                                                |
| ---------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Unit, integration, property, concurrency | `npm test`                                          | 24 files, 124 tests passed, 0 failed                                                                  |
| Enforced isolated-module coverage        | `npm run test:coverage`                             | 91.54% statements (249/272), 87.22% branches (198/227), 98.43% functions (63/64), 95% lines (228/240) |
| TypeScript                               | `npx tsc --noEmit`                                  | 0 errors                                                                                              |
| Lint                                     | `npm run lint`                                      | 0 warnings/errors                                                                                     |
| Format                                   | `npm run format:check`                              | 137 owned files checked, all matched                                                                  |
| Mutation                                 | `npm run test:mutations`                            | 41/41 mutants killed                                                                                  |
| Production dependency audit              | `npm audit --omit=dev --audit-level=high`           | 0 vulnerabilities                                                                                     |
| Secret scan                              | `node tools/check-secrets.mjs`                      | 231 files plus reachable Git history passed; negative control detected                                |
| Real CLI execution                       | unauthenticated `kanby auth status`                 | exited with the documented status 2                                                                   |
| Suite health                             | `vitest --sequence.shuffle --sequence.seed=9082026` | all 124 tests passed                                                                                  |
| Real Worker execution                    | `npm run build`                                     | all five Vinext build phases completed                                                                |
| Recovery schedule                        | `node tools/check-worker-schedule.mjs`              | generated Worker schedule verified                                                                    |

The new scanner mutants prove that removing history inspection, leaking matching history into diagnostic output, or ignoring the selected repository boundary each causes the release suite to fail. The scanner reports locations and categories only, never matched values.

## Additional release checks

- `npx drizzle-kit check`: migration metadata reported consistent.
- `git diff --check`: no whitespace errors.
- License inventory from `package-lock.json`: MIT 775, ISC 36, Apache-2.0 31, MPL-2.0 27, LGPL-3.0-or-later 10, BSD variants 15, and smaller permissive/notice licenses. No proprietary dependency license was found. LGPL entries are optional Sharp/libvips platform packages; CC-BY-4.0 is caniuse data.
- GitHub Actions use read-only repository permissions and the current checkout/setup-node v7 releases pinned to immutable action commit SHAs. The initial v4 run passed but emitted a deprecated Node runtime annotation; the v7 follow-up removed that known warning before tagging.
- Full `npm audit`: 0 critical, 0 high, 4 moderate findings, all under Drizzle Kit's development-only esbuild loader path. Production audit: 0.

## Publication safety finding

`AmazingAng/kanby` initially existed as a private repository with an unrelated 2025 Supabase/Vite/MCP implementation, and its reachable `main` history included a tracked `.env`. With explicit user approval, that repository was renamed to `AmazingAng/kanby-legacy-private` and verified to remain private. No history was rewritten or force-pushed.

A new public `AmazingAng/kanby` repository was then created, and only this scanner-verified source lineage was pushed normally to `main`. The public repository has issues enabled, wiki disabled, private vulnerability reporting enabled, an explicit homepage and description, and focused project topics.

## Independent verification

- Status: not performed.
- Reason: the active collaboration policy did not authorize sub-agent delegation. The work has executable Tier 3 evidence but no fresh-context independent review, so the report does not claim independent assurance.

## Layers not run as specified

- **N-A:** public API compatibility diff — this packaging change adds no application/API behavior.
- **SUBSTITUTED:** changed-line coverage for release documents and the executable secret scanner — documents are contract-tested, and the scanner is protected by RED tests, negative controls, and 3/3 focused mutants; V8 coverage remains scoped to the existing pure application modules.
- **UNAVAILABLE:** browser visual regression — no screenshot baseline or browser automation is configured; the production build is not evidence of visual correctness.
- **N-A:** live Cloudflare deployment — repository publication was requested, but application deployment and production credential mutation were explicitly outside the release spec.

## Dismissed findings

- npm's suggested Drizzle Kit “fix” — dismissed because it proposes `0.18.1`, an incompatible downgrade from `0.31.10`; the findings affect the local development server and the production audit is clean.
- LGPL dependency review — compatible with AGPL distribution and confined to dynamically linked/optional Sharp libvips packages; no source relicensing is implied.

## Structural blind spot

The suite does not exercise a clean-room Cloudflare account from resource creation through OAuth/App installation. The deployment guide and production build are verified, but a first-time external self-host remains a manual integration boundary.

## Honest notes

- Isolation was not possible without losing the current product because most completed Kanby functionality existed only as preserved dirty-worktree changes. No files were discarded.
- An initial attempt to upgrade Wrangler alone failed peer resolution; Wrangler and Workers types were then upgraded together to their compatible versions without `--force` or `--legacy-peer-deps`.
- The first complete gauntlet passed before the final scanner mutation additions. This report records only the fresh gauntlet executed after the final source and evidence edits.
- The canonical public repository was created only after the user explicitly selected the safe rename-and-recreate option; the legacy repository remains recoverable and private.
