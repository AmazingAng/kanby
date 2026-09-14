# Evidence Report — CLI archive and tag validation (Tier 3)

- Spec approval: not obtained (autonomous run after feature-level approval); confidence is downgraded at the specification boundary.
- Source state tested: `8385d42` (`Make Agent archive attribution auditable`).
- Toolchain: versions pinned in `package.json` and `package-lock.json`; Node.js 22.22.1.
- Entry point: `npm run gauntlet`.
- Independent verification: not performed.

## Spec → Test mapping

| Scenario                                                    | Test                                                                                          | Status |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| Valid CLI tag payload                                       | `tests/cli.test.ts` — sends a valid task tag in an update                                     | pass   |
| Invalid tag rejected locally without token transmission     | `tests/cli.test.ts` — rejects an invalid task tag before sending the Agent Token              | pass   |
| Arbitrary non-enum tags rejected                            | `tests/cli.test.ts` — rejects arbitrary non-enum task tags locally (fast-check, 20 cases)     | pass   |
| Accepted tags documented                                    | `tests/cli.test.ts` — documents the accepted task tags                                        | pass   |
| Agent archives active task and activity is Agent-attributed | `tests/agent-archive.test.ts` — archives an active task and records Agent-attributed activity | pass   |
| Archive replay is idempotent                                | `tests/agent-archive.test.ts` — replays an archive idempotently without duplicate activity    | pass   |
| Another Agent's claim blocks archive                        | `tests/agent-archive.test.ts` — rejects archive while another Agent owns the active claim     | pass   |
| Cross-project task cannot be resolved                       | `tests/agent-archive.test.ts` — does not resolve a task from another project                  | pass   |
| CLI emits archive action                                    | `tests/cli.test.ts` — archives a task through the Agent API                                   | pass   |
| Own claim is removed atomically                             | archive API success test plus `Agent archive releases its claim` mutant                       | pass   |
| Must NOT expose permanent deletion                          | API/CLI command surface inspection and package help contract                                  | pass   |

## Gauntlet (fresh run)

| Layer            | Command                                                     | Result                                                                                           |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Full tests       | `npm test`                                                  | 28 files, 150 tests passed, 0 failed                                                             |
| Types            | `npx tsc --noEmit`                                          | 0 errors                                                                                         |
| Lint             | `npm run lint`                                              | 0 errors or warnings                                                                             |
| Format           | `npm run format:check`                                      | 149 files checked, all formatted                                                                 |
| Coverage         | `npm run test:coverage`                                     | 94.86% lines, 91.60% statements, 87.76% branches, 98.48% functions; configured thresholds passed |
| Mutation         | `npm run test:mutations`                                    | 58/58 mutants killed, including five archive/tag mutants                                         |
| Property-based   | `npm test`                                                  | 1 new fast-check property, 20 generated invalid tags                                             |
| Dependency audit | `npm audit --omit=dev --audit-level=high`                   | 0 production vulnerabilities                                                                     |
| Secret scan      | `node tools/check-secrets.mjs`                              | 242 files plus reachable history clean; negative control detected                                |
| CLI package      | `npm run cli:pack:check`                                    | `@kanby/cli@0.2.2`, 4 intended files, 6.2 kB tarball                                             |
| Suite health     | `npx vitest run --sequence.shuffle --sequence.seed=9082026` | 150 tests passed with seed 9082026                                                               |
| Worker build     | `npm run build`                                             | production build completed; recovery schedule verified                                           |

## Layers not run as specified

- SUBSTITUTED — changed-line coverage: the repository coverage allowlist does not instrument the Agent route, database module, or subprocess CLI. Global threshold coverage passed, while contract tests and five targeted mutants exercised the changed behavior; this does not provide a numeric changed-line percentage.
- N-A — migration rollback: no schema migration was added.
- N-A — dependency license review: no dependency changed.
- Independent verification: not performed; the same agent authored implementation and evidence.

## Failures encountered and resolved

- RED run: all six initial archive/tag scenarios failed against the old implementation.
- First gauntlet run failed closed because the pre-existing split-claim mutant no longer matched the extended action list. The target was updated to keep split and archive boundaries independently mutated.
- Second gauntlet run rejected an equivalent activity-source mutant. The redundant object-spread overwrite was removed so Agent attribution has one auditable assignment point.
- An initial production smoke update used an unsupported tag value and received generic HTTP 400. The valid retry succeeded; this directly motivated the local enum validation and precise help text.

## Structural blind spot

- The coverage reporter does not instrument CLI subprocesses or the large Worker route/database modules. Mutation and boundary tests detect the specified regressions, but the report cannot claim complete changed-line execution.

## Honest notes

- Archive is recoverable and intentionally does not expose permanent deletion to Agent Tokens.
- Archive and claim cleanup run in the same D1 batch; idempotent replay returns the original response without a duplicate activity event.
- Production deployment and packaged-CLI smoke result are appended after deployment; until then, real production execution of the new archive command is pending.
