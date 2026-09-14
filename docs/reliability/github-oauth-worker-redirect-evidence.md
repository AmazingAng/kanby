# Evidence Report — Restore GitHub OAuth on Cloudflare Workers (Tier 3)

- Spec approval: not obtained (autonomous repair requested by the user); confidence is downgraded and the spec remains available for review.
- Final verified source state: `a523150` (runtime repair is commit `5c57119`; `a523150` adds only a regression test and mutation probe).
- Deployed Worker version: `caa26e33-06fc-495d-af5f-795f4c88b4a1` from runtime repair `5c57119`.
- Toolchain: versions pinned by `package-lock.json`; Node.js requirement pinned in `package.json`.
- Entry point: `npm run gauntlet`.
- Independent verification: not performed. The task used executable tests, mutation probes, production reproduction, and live Worker logs, but no fresh-context verifier.

## Result

The production 500 was reproduced before editing. Cloudflare logged an uncaught `TypeError` explaining that Fetch redirect mode `error` is unsupported at the edge and that `manual` must be used. Authenticated GitHub requests now use `manual`; existing `response.ok` checks reject 3xx without following them. Empty or non-JSON token/profile error responses are converted into controlled HTTP 400 responses.

## Spec → test mapping

| Scenario or invariant                                        | Evidence                                                                                                                               | Status |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| OAuth token exchange uses Worker-compatible no-follow mode   | `tests/github-oauth-callback.test.ts` — all GitHub requests use `manual`                                                               | Pass   |
| OAuth token endpoint redirects remain rejected               | `tests/github-oauth-callback.test.ts` — token 302 becomes HTTP 400 and profile is not fetched                                          | Pass   |
| OAuth profile endpoint redirects remain rejected             | `tests/github-oauth-callback.test.ts` — profile 302 becomes HTTP 400                                                                   | Pass   |
| GitHub App API requests remain origin-bound                  | `tests/github-security.test.ts` — HTTPS API origin/path constraints and `manual` mode                                                  | Pass   |
| Production OAuth boundary no longer crashes                  | Live matching-cookie diagnostic: before HTTP 500 plus uncaught redirect error; after HTTP 400, `outcome: ok`, no exceptions/log errors | Pass   |
| Production state is preserved                                | Pre/post D1 count comparison, version binding inspection                                                                               | Pass   |
| Must not follow credentialed redirects                       | Three regression tests plus three redirect/non-JSON mutation probes                                                                    | Pass   |
| Must not weaken OAuth state, PKCE, origin, or session checks | Existing auth suite and full gauntlet                                                                                                  | Pass   |
| Must not change CLI redirect behavior                        | `packages/cli/bin/kanby.js` remained unchanged; CLI mutation still killed                                                              | Pass   |
| Must not change production data or storage                   | No migration/write smoke test; D1 `rows_written=0`; same D1/R2 identifiers                                                             | Pass   |

## Gauntlet — final fresh run

| Layer                     | Command                                      | Result                                                                                                                          |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tests                     | `npm test`                                   | 27 files, 141 tests passed, 0 failed                                                                                            |
| Types                     | `npx tsc --noEmit`                           | 0 errors                                                                                                                        |
| Lint and format           | `npm run lint`; `npm run format:check`       | 0 errors; 146 files formatted                                                                                                   |
| Enforced project coverage | `npm run test:coverage`                      | statements 91.60%, branches 87.76%, functions 98.48%, lines 94.86%; thresholds passed                                           |
| OAuth route coverage      | targeted Vitest V8 coverage                  | 3 tests; 54/68 statements and 51/62 lines; every changed redirect/error-handling statement executed                             |
| Mutation                  | `npm run test:mutations`                     | 53/53 killed, including token redirect, token non-JSON, profile redirect non-JSON, GitHub App redirect, and CLI redirect probes |
| Property/concurrency      | `npm test`                                   | Existing fast-check and concurrency suites included in 141 passing tests                                                        |
| Real execution            | production HTTPS requests plus Wrangler tail | `/` 200, `/demo` 200, session 200, auth start 302 to GitHub with S256 PKCE, invalid callback 400; no Worker exceptions          |
| Supply chain and secrets  | gauntlet audit and secret scan               | 0 production vulnerabilities; 239 files plus reachable history scanned; negative control detected; no new dependency            |
| Suite health              | randomized seed `9082026`                    | 27 files, 141 tests passed                                                                                                      |
| Worker build              | `npm run build`                              | production build and recovery schedule check passed                                                                             |

Final result: `GAUNTLET PASS: 13/13 layers`.

## Production preservation evidence

- Previous Worker version: `40f52bea-262c-4ca0-b263-6a0189b94982`.
- New Worker version: `caa26e33-06fc-495d-af5f-795f4c88b4a1`, 100% traffic.
- D1 stayed `kanby-db` / `28a0519b-781a-4ca0-a59e-2a6d1e6c20e7` and R2 stayed `kanby-attachments`.
- Pre/post counts were identical: 3 users, 2 projects, 4 memberships, 2 invitations, 41 tasks, 0 attachments, 26 acceptance items, 5 GitHub task links, 720 task events, 6 Agent Tokens, and 2,755 GitHub events.
- Post-deployment D1 verification reported `rows_written=0`.
- No migration, secret rotation, custom-domain route, D1 mutation, or R2 write/delete occurred.

## Layers not run as specified

- Independent verification: not performed; no separate verifier was requested or used.
- Full browser completion with a real GitHub authorization code: not performed because it requires a user's authenticated GitHub browser session. The success path is covered with simulated GitHub responses and a real migrated D1 test database; the exact previously crashing production token-exchange boundary was exercised live.

## Dismissed findings

- Suspected missing `PUBLIC_APP_ORIGIN`: dismissed by `wrangler versions view`; the active and replacement versions both bind `https://kanby.0xaa.workers.dev`.
- Suspected missing login tables/migrations: dismissed by remote read-only schema inspection; all user, project membership, and invitation tables exist.

## Structural blind spot

The automated environment cannot complete GitHub's human authorization screen. A user should still perform one normal browser login as final end-to-end confirmation; the previous unconditional Worker crash has been removed and its production boundary now completes normally.

## Honest notes

- RED was observed as three failures: callback requests and GitHub App requests used `error` instead of `manual`.
- The first gauntlet stopped at formatting; only mechanical formatting was applied.
- A later gauntlet stopped when npm rejected a stale local workspace dependency tree. `npm ci --ignore-scripts` rebuilt it from the committed lockfile, after which the entire gauntlet was rerun from the beginning and passed.
- The deployed runtime predates the final extra profile-redirect test commit but contains the exact same runtime files as the final verified state.
