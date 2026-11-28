# WeChat Worker transport fix evidence

Spec: WEIXIN_WORKER_FIX_SPEC.md, including fallback transport amendment.
Spec approval: not obtained (autonomous run). Independent verification: not
performed. Existing clean isolated worktree reused locked dependencies; local
`.env` was not copied into it. No new dependencies, schema or secret changes.

Production log reproduced TypeError before fetch: Workers only implements
redirect follow/manual. Both iLink and fallback webhook now use manual; existing
HTTP status handling rejects 3xx.

- RED: all six new iLink transport tests failed on the original mode.
- RED amendment: Worker-semantics mock exposed fallback regression; five new
  webhook redirect cases failed with TypeError instead of HTTP status errors.
- GREEN: `npm run gauntlet` passed 17/17 layers, 291 tests in 42 files;
  randomized suite also 291 passed. Types, lint, format, coverage gates, build,
  schedule verification, secret scan and production audit passed (0 vulnerabilities).
- Mutation: 102/102 killed, including six new Worker-mode, redirect-forwarding
  and redirect-response acceptance mutants. Each executed and source restored.
- `tests/weixin-transport.test.ts` checks 301/302/303/307/308, with 20 arbitrary
  destination URLs per status (fixed seed), and successful QR generation.
- `tests/weixin.test.ts` checks the full bind/activate/send/fallback flow and
  rejects each redirect status in fallback delivery. Existing ownership,
  encryption and stale-login race tests still pass.
- Public API signatures, host allowlists and DB behavior unchanged; full suite
  covers these invariants. Implementation adds no functions or dependencies.

Coverage limitation: existing gauntlet coverage gates do not include these two
transport files. Supplemental V8 coverage ran the 18 relevant tests, but LCOV
has no separate counter on object-property lines; a direct changed-line assertion
failed due to absent instrumentation. Do not claim changed-line coverage 100%.
The executed fetch paths and six transport mutants provide behavioral evidence.

Reproduce the complete validation with `npm ci && npm run gauntlet` (Node

> =22.13, package-lock pins tool versions). Runtime smoke and deployment records
> will be appended after preview verification and production release. Actual
> WeChat activation/delivery remains pending the user's scan and first message.

Runtime evidence: code commit `062932d7c2a31948f9db8bf65deeea1262a8d2c0` merged
into main and pushed. Preview deployment `408fde62-3398-4fe7-bc18-b334ce3d5a9c`
uses artifact `d6542499-2b20-4d37-b277-b295ace19474` (SHA-256
`997dd8a9ab57408200ef5effb5a766df4a2fc72c7a170dcfb2b4349b32a3fa0d`).
A synthetic preview member successfully generated a real upstream QR, polled
`wait` with no bound account, and cleared its temporary login. No QR or session
credentials were logged; no messages sent. Preview recovery cron remains paused.

Production deployment `8f049d39-a703-4ba5-930f-7745548ce988` is ACTIVE with the
same artifact. All 15 public HTTP/assets/auth-boundary checks passed. Exactly one
production recovery cron remains enabled; preview and legacy HTTP crons paused.
User's existing Chrome login (AmazingAng) successfully generated the production
binding QR. User scan/activation and real delivery still pending at this record.
