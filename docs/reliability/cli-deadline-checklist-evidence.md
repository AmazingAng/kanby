# EVIDENCE — CLI deadlines and acceptance completion

## Outcome

CLI `0.3.0` accepts `task create --due YYYY-MM-DD`. The Agent create route
validates the calendar date before writing and includes it in the initial task
insert. Adding a note preserves that deadline. `task update --due ""` now clears
it correctly, and a missing flag value fails locally.

The canonical skill now explicitly covers creating a requested card with a
deadline and finishing work by listing, validating, checking individual criteria,
re-listing, and completing. CLI and API completion semantics remain unchanged:
`complete` never checks acceptance items automatically.

## Source and reproducibility

- Runtime/source commit: `0657bac`.
- `node tools/source-state.mjs`: `b93b02109d24876de238d687f6949901c5563e5e9d7058d9010b39c5f1e9c4ae` over 240 files (evidence files excluded).
- Specification: `docs/reliability/cli-deadline-checklist-spec.md`.
- One release-check entry point: `npm run gauntlet`.
- Targeted workflow: `npx vitest run tests/agent-deadline-workflow.test.ts`.
- Toolchain: Node.js 22.22.1, npm 10.9.4, existing versions in `package-lock.json`.
- Work ran in an isolated branch/worktree. `npm version` materialized its linked
  dependency directory into a local install of the same locked packages. No new
  dependency, schema migration, or production credential was introduced.

## Behavior-to-evidence mapping

| Behavior                                           | Evidence                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline survives creation and adding a note       | Two API tests assert response and persisted SQLite values                                                                                 |
| Empty or omitted deadline remains compatible       | Two API tests and a CLI option-before-title test                                                                                          |
| Invalid dates and non-string inputs create no card | Nine hostile-input cases assert HTTP 400, zero task rows, and a successful corrected request using the same idempotency key               |
| Date-only values round-trip                        | 30 generated valid dates per property run plus explicit valid and invalid leap days                                                       |
| Retrying creation does not duplicate tasks         | Same-key replay and different-deadline conflict test                                                                                      |
| Explicit empty CLI value clears a deadline         | Actual CLI subprocess updates the real route handlers and SQLite-backed D1 adapter                                                        |
| Missing flag value fails before network activity   | CLI create/update tests against an unreachable address assert the local validation error                                                  |
| Verified checklist remains checked when completed  | Actual CLI create, claim, checklist add/list/check by number and ID, re-list, and complete flow; final response and stored state asserted |
| Skill examples agree with the CLI                  | Manual review, CLI help/version execution, and the skill-creator frontmatter validator                                                    |

## Test results

- RED: initial targeted run had 17 failures and 2 existing compatibility passes.
  The later option-before-title regression test and existing optional behavior
  were validated with non-equivalent mutation probes.
- Final targeted run: 1 file, 20 tests passed.
- Full and randomized suites: 29 files, 174 tests passed; shuffle seed `9082026`.
- Mutation gate: 70/70 killed, including eight new probes for deadline validation,
  optional compatibility, database persistence, note preservation, CLI forwarding,
  empty option handling, positional consumption, and actual checklist checks.
- TypeScript, lint, formatting, CLI exit contract and package contents: passed.
- Production dependency audit: zero vulnerabilities.
- Secret scan and its negative control: passed.
- Worker production build and recovery schedule: passed.
- Full release gate: `GAUNTLET PASS: 13/13 layers`.
- Skill validation initially caught an unquoted colon in YAML; the description
  was corrected and the final validator passed.

The configured coverage allowlist reported 91.6% statements, 87.65% branches,
98.48% functions, and 94.86% lines. It does **not** include the changed Agent
route, database module, or subprocess CLI; no enforced changed-line coverage
percentage is claimed for them. Their evidence is the API/storage/subprocess
integration tests and mutation probes above. The generated-date property covers
valid dates; hostile-input rejection is covered by separate matrix tests.

## Deployment

- Deployed source: `0657bac`.
- Worker version: `3fa6f900-d831-45ee-ab35-f4c0296960ca`.
- Origin: `https://kanby.0xaa.workers.dev`.
- Production D1, R2, secret binding names, origin, and ten-minute recovery cron
  retained. No migration or authenticated production task mutation performed.
- Home and Demo returned HTTP 200. Unauthenticated Agent creation returned 401.
  GitHub OAuth returned 302 with the existing Worker callback.
- npm publication is outside this request; install/update the CLI from the repo.

## Confidence limits

Spec approval: not obtained (autonomous run). Independent verification: not
performed. The adversarial pass used hostile dates, malformed values, corrected
retries and missing CLI values, but was authored by the implementing agent.
Authenticated create/check/complete was exercised locally through the actual
route handlers and SQLite adapter, not against a live production project.
Completion still relies on the agent following the skill; the API does not
prevent shipping a task with unchecked criteria or prove the evidence itself.
