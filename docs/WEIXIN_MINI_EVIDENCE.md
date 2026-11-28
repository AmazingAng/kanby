# Personal WeChat mini program evidence

Contract: KANBY-145; specification: WEIXIN_MINI_SPEC.md.
Implementation: c26ca33631da261f146e806ef24eb57179ca4ab1.
Base: 0fcd118; specification checkpoint: 8339ca5.
Validation date: 2026-11-28 (Asia/Shanghai).

Spec approval: not obtained (autonomous run). User authorized the feature and
explicitly requested code/local verification first because the mini program has
not been registered. Independent fresh-context verification: not performed.
This is tested implementation evidence, not proof of platform acceptance.

## Reproduce

Use the locked dependencies, Node v22.22.1 and npm 10.9.4 used for this run:

```sh
npm ci --ignore-scripts
npm run gauntlet
```

The gauntlet manifest has 19 layers and fails on a missing or failing layer.
The final complete run occurred after the last source edit, including the OAuth
button's full-page navigation and concurrent-unlink handling. It returned
`GAUNTLET PASS: 19/19 layers`.

| Layer                                        | Final result                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Full suite                                   | 320 tests, 45 files passed                                                                               |
| Existing coverage gates                      | General, metrics, xAPI boundary, sessions, recovery and task deep-link gates passed unchanged            |
| Mini-specific coverage (`npm run test:mini`) | 25 tests, 2 files passed; 174/174 statements, 166/166 lines, 110/110 branches, 30/30 functions           |
| TypeScript                                   | `tsc --noEmit` passed                                                                                    |
| Lint and format                              | Passed; native WeChat CommonJS alone is excepted from the ESM-only lint rule                             |
| Mutation gate                                | 115/115 killed, including 10 new mini defects; runner verifies unique replacement and source restoration |
| Production dependency audit                  | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities                                             |
| Secret scanner                               | Passed, including existing negative control                                                              |
| CLI contracts and package contents           | Passed                                                                                                   |
| Shuffled full suite                          | Seed 9082026: 320 tests, 45 files passed                                                                 |
| Worker production build                      | Passed, then Worker recovery schedule verified                                                           |

No dependencies were added or upgraded. The installed full development dependency
set reported existing audit findings during npm ci; the production audit is the
specified gate. License re-audit was not performed because the dependency set did
not change. The isolated worktree used its own dependencies and did not copy the
main checkout's .env, credentials, or build outputs.

## Contract-to-evidence mapping

| Spec clause                         | Executable evidence                                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: unconfigured/provider boundary   | `fails closed without configuration...`, `rejects provider redirects, errors and malformed identity...`; fixed provider URL/manual redirect request checked, no provider call when disabled                                                                             |
| 2: explicit existing-user binding   | `binds once...`, `rejects expired pair codes and stale browser authorization`, `allows only one binding winner...`, `allows at most one identity per account...`; real SQLite uniqueness and conditional insert                                                         |
| 3: scoped/revocable sessions        | `revokes on logout, unlink, expiry and application change`, `rejects well-formed forged mini tokens...`, `does not report successful login when the binding is removed...`; existing browser auth rejects mini token; cookie rejected by mini routes                    |
| 4: bounds/errors                    | `limits unauthenticated exchanges...`, `uses short lived pairing and bounded session retention...`, malformed/oversized/non-JSON/unknown action tests; absent or arbitrary bearer strings rejected                                                                      |
| 5: live project permissions/reading | `enforces membership on queue, detail, comments and checklist writes`, `lists the real queue, resolves task refs, pages comments...`; permission removal and archived/foreign task access rejected                                                                      |
| 6: attributed writes/CAS            | `requires completed criteria and current revision...`, `returns conflicts for concurrent acceptance and stale checklist item revisions`, `refuses acceptance when a task owner is no longer a project member`; one successful transition/activity in a two-request race |
| 7: native client behaviors          | Six client tests execute the page/transport in Node VM with wx/API boundary doubles: deep link through login, failed comment retention/401, confirmation/duplicate submit guard, bearer headers, HTTPS/path restriction, every WXML event has an executable handler     |
| 8: registration and release limits  | miniprogram/README.md includes exact configuration, binding, migration, rollback and real-device checklist; no AppID/Secret, platform publishing or notification deep-link success claimed                                                                              |

Both arbitrary-string and syntactically valid forged-token properties ran 50
cases with fixed seeds. These are exercised properties, not a claim that the
property subset independently kills all mutants; property-only mutation reruns
were not performed.

The in-memory D1 adapter executes real SQL and models serialized D1 batches for
concurrent acceptance. The binding race has two existing users compete for one
pair code: exactly one succeeds, with no new users or memberships. The migration
rollback rehearsal removes the four new mini tables and verifies the original
task and user still exist. It is not a production restore rehearsal.

## Real Worker execution

After the final build, start an unconfigured local Worker:

```sh
npx wrangler dev --config dist/server/wrangler.json --ip 127.0.0.1 --port 8788 --local --var WEIXIN_MINI_APP_ID:disabled-for-smoke
```

In another terminal, the following requests were actually executed:

```sh
curl -i http://127.0.0.1:8788/mini
curl -i http://127.0.0.1:8788/api/mini/tasks
curl -i -X POST -H 'Content-Type: application/json' -d '{"action":"login","code":"local-smoke"}' http://127.0.0.1:8788/api/mini/auth
curl -i http://127.0.0.1:8788/api/mini/account
```

Observed statuses: 200, 503, 503, 403 respectively. Mini responses used no-store;
unconfigured login returned the explicit configuration message, without querying
WeChat. The invalid smoke AppID deliberately prevents live provider calls even if
a developer has other environment settings.

Browser inspection of the actual /mini page confirmed the heading, explanation,
signed-out message and GitHub button render. Clicking that button performed full
navigation to `/api/auth/github?returnTo=%2Fmini`; the unconfigured local GitHub
endpoint returned its configuration message. No real GitHub OAuth consent,
account linking UI submission or WeChat login was performed.

## Failures resolved and limits

- Initial behavior RED: eight backend tests and three client tests failed against
  explicit throwing stubs, not import failures. Additional defenses already
  implemented were attacked by the final mutation suite.
- Initial full suite could not bind loopback HTTP ports in the sandbox. Re-run
  with local-listener permission passed; no test timeout was relaxed.
- The first integration result exposed the existing activity store's `events`
  field; the mini adapter now maps it to the specified `activity.items` contract.
- Retention initially used a random token hash to break equal-time ordering.
  A failing retention test led to rowid ordering; the regression freezes time.
- Concurrent unlink initially returned an unusable token with success. A focused
  RED test reproduced 200 versus expected 409. Session issuance now checks the
  conditional database insertion, and a dedicated mutant verifies the guard.
- Type/format/lint issues were fixed without loosening assertions. OAuth uses a
  full-navigation button to avoid router prefetch starting an authorization flow.

The 100% mini coverage claim covers **only** lib/weixin-mini.ts and the three
mini API routes. Native JavaScript runs through VM tests and is not included in
that V8 coverage gate. React UI branches, WXML/WXSS and schema/config files have
no claimed 100% changed-line coverage. This is a declared reduction from the
skill's ideal every-changed-line coverage, not silently counted as covered.

Real WeChat developer-tool compilation, phone rendering, actual code exchange,
platform account/classification/domain/filing/review requirements, production D1
migration and deployment, and iLink-notification-to-mini opening are unverified.
The current notification URLs remain web URLs. These are registration/release
follow-ups explicitly deferred by the user, not successful checks.

No separate performance benchmark or formal complexity tool was added (no stated
latency target); handlers reuse existing task/queue functions. Project task detail
currently scans the existing listTasks result, suitable for the current small-team
scope but not a large-board performance claim. Database/WeChat failures return
bounded generic errors; production availability and multi-region failure testing
were not performed.
