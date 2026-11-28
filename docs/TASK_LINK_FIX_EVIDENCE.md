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
