# Evidence Report — Kanby CLI production token smoke test (Tier 3)

- Spec approval: not obtained (autonomous diagnostic run); confidence is limited to the scenarios below.
- Source state before this evidence artifact: `6f62dffc6f163bc79e20ab4ed733794deb2160912f55169875da43999b9207af` across 185 files, produced by `node tools/source-state.mjs`.
- Toolchain: Node.js 22.22.1, npm 10.9.4, versions pinned in `package-lock.json`.
- Local gauntlet entry point: `npm run gauntlet`.
- Independent verification: not performed; the run was a read-only credential smoke test with no implementation changes.

## Spec → Test mapping

| Scenario                     | Executed check                                                                                     | Status |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| Valid token authenticates    | Production `auth status --json` returned authenticated project `xAPI` / `xapi`, exit 0             | pass   |
| Token lists projects         | Production `project list --json` returned one project, exit 0                                      | pass   |
| Token lists tasks            | Production `task list --json` returned a seven-item JSON array, exit 0                             | pass   |
| Token reads task detail      | Production `task get <ref> --json` returned a task with id, ref, title, owner, and status, exit 0  | pass   |
| Invalid token is rejected    | Production `auth status --json` with a deliberately invalid token returned HTTP 401 and CLI exit 2 | pass   |
| Must NOT persist the token   | All commands used an isolated empty `XDG_CONFIG_HOME`; no `config.json` was created                | pass   |
| Must NOT mutate project data | Only `auth status`, `project list`, `task list`, and `task get` were executed                      | pass   |
| Must NOT expose the token    | Captured stdout and stderr contained no token-shaped values; the repository secret scan passed     | pass   |

## Gauntlet (final fresh run)

| Layer                     | Command                                                        | Result                                                                |
| ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| Production authentication | `kanby auth status --json` with the supplied environment token | exit 0; project resolved                                              |
| Production project read   | `kanby project list --json`                                    | exit 0; 1 project                                                     |
| Production task read      | `kanby task list --json`; `kanby task get <ref> --json`        | exit 0; 7 tasks; detail readable                                      |
| Rejection path            | `kanby auth status --json` with invalid token                  | exit 2; HTTP 401                                                      |
| Tests                     | `npm run gauntlet`                                             | 72 passed, 0 failed; randomized rerun 72 passed                       |
| Types                     | `npm run gauntlet`                                             | 0 errors                                                              |
| Lint and format           | `npm run gauntlet`                                             | 0 warnings; 93 files formatted                                        |
| Coverage                  | `npm run gauntlet`                                             | 95.18% statements, 88% branches, 100% functions, 99.31% lines         |
| Mutation                  | `npm run gauntlet`                                             | 22/22 mutants killed                                                  |
| Supply chain and secrets  | `npm run gauntlet`                                             | 0 production vulnerabilities; secret scan and negative control passed |
| Real execution            | Production Worker at `https://kanby.0xaa.workers.dev`          | valid and invalid authentication paths observed                       |
| Production build          | `npm run gauntlet`                                             | Worker build completed; 11/11 gauntlet layers passed                  |

## Layers not run as specified

- N-A: UI checks — this diagnostic exercised only the CLI/API authentication surface.
- N-A: write-path rollback — the specification intentionally prohibited production mutations.
- UNAVAILABLE: a fully repository-only replay of the live credential checks is impossible because the supplied token is deliberately not stored.

## Structural blind spot

- This run verifies authentication and read operations. It does not prove that this token can create, claim, update, split, link, complete, or release tasks because exercising those commands would alter the user's production project.

## Honest notes

- The first orchestration attempt was rejected before execution because it included temporary-directory deletion; the successful run omitted cleanup and did not contain the token in any captured artifact.
- No application implementation or dependency was changed.
