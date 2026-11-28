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
