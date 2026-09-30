# Interaction sessions evidence

- Tier: 3 (public API, attribution and concurrency).
- Spec: [interaction-sessions-spec.md](interaction-sessions-spec.md).
- Spec approval: not obtained (autonomous run); review after the fact. This
  lowers confidence in completeness of the specification.
- Implementation commit: `2073af5`.
- Source hash: `918a35aec3ce97005fe934b55b34b94894402688c370bbcf4d6b21d0c2e1649d`
  over 277 paths, produced by `node tools/source-state.mjs`. Evidence files are
  excluded by that script. Ignored local environment/build files are not hashed.
- Toolchain: Node 22.22.1, npm 10.9.4; pinned tools in package-lock.json.
- Reproduce: `npm ci && npm run gauntlet`.
- Skill check: `python3 /path/to/skill-creator/scripts/quick_validate.py skills/kanby`
  passed; validator belongs to the local skill toolchain, not this repository.

## Contract mapping

| Scenario                                                        | Evidence                                                                                                        | Result                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Project-only and optional task sessions; unchanged cards/claims | interaction-sessions.test.ts: starts project-only and task sessions                                             | Pass                                                          |
| Project, member, task and scope isolation                       | isolates project reads, task association, member writes and scopes; hostile input; authenticated response tests | Pass                                                          |
| Event lifecycle, retries and concurrent writes                  | deduplicates start and event replay; real competing store writes; pause/deferral/second wait                    | Pass                                                          |
| Correlated response and honest provenance                       | correlates replies with open waits; separates authenticated human responses; CSRF and forgery checks            | Pass                                                          |
| Stale/ended/cancelled distinction                               | marks stale sessions unknown; unresolved end; period-end replay                                                 | Pass                                                          |
| Bounded history and metrics                                     | cursor tests, capacity rejection, missing-start history, pending latency, zero-observation members              | Pass                                                          |
| Actual CLI integration and supervisor                           | interaction-cli.test.ts: five subprocess scenarios against local HTTP route handlers                            | Pass                                                          |
| Skill workflow and metadata-only defaults                       | skill validation, command/help inspection, CLI test proving private child output is absent from event history   | Pass for checked paths; autonomous skill adherence unverified |
| Additive migration and existing compatibility                   | migration transaction rollback test, all prior tests, Worker build                                              | Pass locally; remote migration not performed                  |

## Final local gauntlet

All numbers below are from one complete run after the final implementation and
test changes. Formatting of this evidence report does not change that source.

| Layer                                     | Result                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| Full test suite                           | 35 files, 236 tests passed (22 new interaction tests)                             |
| Existing coverage gate                    | 96.87% lines; 94.60% statements; 90.68% branches; 99% functions                   |
| Delivery metrics coverage                 | 27 tests; 100% lines; 94.93% branches                                             |
| xAPI migration/recovery boundary coverage | 10 tests; 100% lines; 98.38% branches                                             |
| New session server coverage               | 17 tests; 231/231 lines, 247/248 statements, 215/220 branches, 38/38 functions    |
| TypeScript                                | Pass                                                                              |
| Lint and format                           | Pass                                                                              |
| Mutation testing                          | 85/85 killed, including 7 new session mutants                                     |
| Production dependency audit               | 0 vulnerabilities                                                                 |
| Secret scan                               | Pass over 287 files and reachable Git history; built-in negative control detected |
| CLI unauthenticated contract              | Pass                                                                              |
| CLI package preview                       | Pass, including bin/session.js; CLI version 0.5.0                                 |
| Randomized suite order                    | 236 tests passed, seed 9082026                                                    |
| Worker production build                   | Pass                                                                              |
| Worker recovery schedule                  | Pass                                                                              |
| Manifest                                  | 16/16 layers passed                                                               |

Property-based replay exercises 100 generated interval sequences and verifies
exact nearest-rank percentiles, sample count and zero unresolved waits. The
self-authored adversarial pass exercised spoofed identities/provenance, CSRF,
invalid fields/JSON, cross-project queries, stale request IDs, competing writes,
partial-write failure, large histories and repeat supervisor launch.

## RED and repair history

- The first seven API tests failed against explicit 501 stubs before implementation.
- Three initial CLI integration tests failed before session commands existed.
- Added regressions reproduced interception of the child `--version` flag and
  duplicate process execution when reusing a previously started session ID.
- Server clock cutoff initially excluded same-millisecond replies; the contract
  tests detected it. Ongoing reports now include events received at `now` while
  completed calendar periods keep an exclusive end boundary.
- Later security and state regression tests exercised existing implementation;
  they were not all observed RED independently. The seven targeted mutants
  validate selected ownership, correlation, replay, revision, provenance,
  liveness and percentile assertions, not every assertion.
- Static checks rejected a control-character regex / string spread and a missing
  sort comparator. Validation now checks ASCII control code units explicitly.
- Generated Drizzle metadata needed formatting. The secret scanner rejected a
  fixed synthetic test secret; the fixture now generates it at runtime. No
  scanner rule or existing test was weakened.

## Limits and verification not performed

- Independent fresh-context verification: not performed. Self-review shares the
  implementation author's blind spots; this is not proof of complete correctness.
- Quantitative new-code coverage covers server session modules and routes. CLI
  subprocesses are integration-tested but their line coverage is not measured.
  Periodic supervisor heartbeat timing and OS signal delivery were not separately
  timed/stress-tested across operating systems.
- No provider-specific lifecycle adapters, OS-wide capture, offline queue,
  business-hours calendar or verified-human UI is included. The browser API is
  authenticated, but a cookie submission does not prove physical human action
  or review quality. Agent Token reports remain explicitly unverified.
- Only instrumented sessions are observed. Missing clients or failed calls are
  unknown; report coverage never claims completeness. Reports fail above 10,000
  selected events. Old long sessions can reach that bound even for short periods.
- No raw chat or subprocess output is captured automatically. Explicit summaries
  still depend on callers to omit sensitive information.
- No live Worker deployment, remote D1 migration or npm publication was performed
  for this change. Source merge alone does not activate the new service API.
- Existing development-only Drizzle/esbuild audit findings remain outside this
  feature; the production-only audit gate passes. No dependencies were added.

Dismissed findings: none. Known limits are listed above.
