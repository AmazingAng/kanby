# Mini board and loading evidence

KANBY-145, 2026-11-28. Contract: WEIXIN_MINI_BOARD_SPEC.md. Spec approval was
not obtained (autonomous run). The formal independent old-coder verification
protocol was not performed. A separate agent reviewed the backend diff and found
no blocking issue; it noted the unpaginated board and remaining D1/network cost.

## Behavior and evidence map

- Full nickname, native button sizing, queue/board switch, horizontal columns,
  and immediate title placeholder: `tests/weixin-mini-layout.test.ts` plus
  inspection of an HTML projection at 390px using representative native button
  default selectors. These are template/cascade checks, not native phone proof.
  Both new layout contracts failed against 0.1.2 before implementation.
- Member-only active board, default queue compatibility, ID/number parity,
  foreign/archived exclusion: new real SQLite cases in
  `tests/weixin-mini.test.ts`. The board response and two query-cost cases failed
  before implementation. Query-scope tests add 150 unrelated tasks and their
  relationships and assert bounded returned rows and indexed target lookup.
  A blocked-query test proves six independent relationship/agent reads start
  before any is released. This does not measure production D1 round-trip latency.
- Immediate preview, warm cache with fresh-write gate, retained view on back,
  late responses, project/account changes, revocation, mismatch refusal, cache
  eviction and writes during navigation: deferred-promise cases in
  `tests/weixin-mini-client.test.ts`. A separate regression first reproduced an
  old request's 401 erasing a newer token; the transport now removes only the
  token belonging to that request.
- Six new mutants exercise board routing, accidental full-project detail scans,
  archived detail exposure, cache account isolation, mismatched-task writes and
  late 401 token removal. Existing acceptance and deep-link mutants are retained.

## Scope and limitations

No dependencies, migration, credentials, permissions or domains were added.
Details use an indexed task lookup and parallel relationship reads. The default
queue and write revision checks remain intact. Cache contents stay in page
memory, bounded to 20 detail entries, and never authorize writes before fresh
validation. No live user session was minted for benchmarking.

The board deliberately returns the existing complete active-task records; it is
not paginated and existing listTasks relationship reads include archived history.
Large projects can still incur payload and database work. Detail activity still
follows task hydration. No claim of instant cold opens or measured phone latency
is made. The existing mini API coverage gate does not measure every new db.ts or
VM-loaded client line; focused behavioral tests cover those paths without a
claimed coverage percentage. Native WeChat layout and interactions remain for
user acceptance after scanning the new official preview.

## Release results

Implementation commit: `20037ed`. The final `npm run gauntlet` passed 19/19
layers: 352 tests in 46 files, 122/122 mutations killed, existing coverage gates,
TypeScript, lint/format, secret scan, randomized tests and Worker build/schedule
checks. Production dependency audit found zero vulnerabilities. The new layout
and client tests are behavioral/template contracts, not a native runtime.

xAPI preview and production use the same ACTIVE artifact
`328d4f8f-ca00-4e2a-b42f-e87b03957088`, content SHA-256
`483211a904d6a48df4a67adbc6f8e4d0b55c5e5250bc93ac0303e112c739ba5c`.
Production deployment is `96b87e8b-4a52-4a38-9eaf-c45081830884`.
Both D1 and R2 resource IDs match the pre-deployment snapshots. Exactly one
production native recovery schedule remains enabled; preview and legacy HTTP
schedules are paused.

Preview and kanby.dev both returned 200 for /demo and /mini, 401 with no-store
for unauthenticated project/board/detail requests, and 404 for the absent
migration endpoint. These public probes do not verify an authenticated live
mini session; that requires the user's phone. Full authenticated contract tests
ran against the migrated SQLite fixture with the real API handlers.

Official miniprogram-ci 2.1.31 compiled/uploaded development version 0.1.3
successfully (971,281-byte upload archive) and generated a new official preview
QR. Receipts are private and ignored under outputs/mini-board-20261128/private;
the preview QR is one directory above. No AppSecret or upload key is committed.
This is a development/preview upload, not a reviewed public mini release.

KANBY-145 remains building for human phone acceptance. Existing binding is
preserved. Reopen using the new QR, verify nickname/checklist widths, switch
queue/board, open cards and return while loading, then verify comments and
acceptance on an appropriate card.
