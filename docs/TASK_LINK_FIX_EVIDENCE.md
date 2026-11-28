# KANBY-144 task-link sign-in evidence

Spec: TASK_LINK_FIX_SPEC.md. Spec approval: not obtained (autonomous run).
Independent verification: not performed. Scope is the login destination and its
client state; no authorization, data model, task mutation or dependency change.
Isolated worktree reused locked dependencies, without copying local .env.

Observed before fix: authenticated Chrome opened KANBY-144 at desktop and
390x844 viewport. A separate signed-out browser at the exact same notification
URL rendered login href with returnTo=/xapi/board, dropping the task parameter.
This reproduces a path that leads to the user's screenshot, without assuming
access to the phone's authentication history.

RED: three new tests failed when the helper used the original board-only
return path, including the complete OAuth start/cookie/callback exchange.
Existing board/root return paths passed and are defended by a mutation.
Initial integration failed React lint (ref accessed during render). Corrected
by retaining the initial task reference in state and using a separate ref for
one-time opening. No lint rule or assertion was weakened.

Tests map to acceptance:

- tests/task-deep-link.test.ts: exact numeric and legacy references; unchanged
  root/board fallback; 100 arbitrary query values with a fixed seed; actual OAuth
  route functions preserving task in callback Location (GitHub network mocked).
- Existing auth-security and OAuth callback tests retain CSRF/PKCE, redirect and
  membership behavior. Browser smoke verifies the component uses the helper.
- Three new mutants discard the reference, disable query encoding, or discard
  project selection; all killed. Whole mutation suite: 105/105 killed.
- A separate gauntlet coverage gate requires 100% helper lines/statements,
  branches and functions: 2/2 statements/lines, 4/4 branches, 1/1 function.
  It does not claim entire Kanban component coverage.

Reproduce with npm ci && npm run gauntlet (Node >=22.13; package-lock pins tools).
Full gate and deployment/browser results appended after completion. The phone's
actual click remains user acceptance; do not mark it passed from desktop alone.

Final local run after implementation edits: npm run gauntlet PASS 18/18 layers;
295 tests / 43 files, randomized order also 295 passed; all coverage gates,
TypeScript, lint, format, 105 mutations, secret scan, CLI checks, production
Worker build and native schedule verification passed. Production audit found
0 vulnerabilities. Build warnings did not fail checks. No new functions beyond
the small destination helper, no new outbound capabilities.

Release: implementation `69b6e54` merged/pushed to main. Preview deployment
`6a6c47db-8ec2-441d-a077-0a5940199b19`; artifact
`1439bfb3-1b24-4c75-9d70-1c5014112974`, SHA-256
`1a01d6be6feaf5476421a84faf6b4dcf96c6dacb1a1e089cf5cf0636d17b9aa7`.
Preview signed-out UI now renders
`/api/auth/github?returnTo=%2Fxapi%2Fboard%3Ftask%3DKANBY-144`.
The same artifact was promoted to production deployment
`6d3451d1-2520-4356-9220-43aadcb3f22e` (ACTIVE). All 15 production public HTTP,
asset and auth-boundary checks passed. No data or credential changes.

Production browser evidence: signed-out UI retains the task parameter;
existing real Chrome session at 390x844 automatically opens the KANBY-144 form
with the expected title. Unknown KANBY-999999999 opens no editor, while the board
loads normally. Viewport override reset afterwards. Real phone re-click and
interactive GitHub consent are pending user verification; route integration
covers OAuth response behavior with mocked GitHub network.

Automatic approval review rejected clicking Save-and-close on the real task,
because that action could persist an unchecked form. It was not bypassed.
An isolated, nonpersistent demo card was used to check closing instead; its
editor closed. Reopening on a production polling refresh was not separately
verified. Existing one-time deep-link opening code was left unchanged.

KANBY-144 keeps the phone-link criterion pending and status building; real
notification receipt was already confirmed by the user. Deployment evidence and
retest instructions were handed back on that same card; no duplicate created.
