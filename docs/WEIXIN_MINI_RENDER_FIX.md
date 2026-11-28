# Mini program conditional rendering fix

KANBY-145, 2026-11-28. The user completed web binding but the phone still showed
the login panel, blank pairing fields and a blank error panel. Chrome confirms
the account is linked. The WXML uses literal strings such as wx:if="error" and
wx:if="!authenticated" instead of data-binding expressions, so these nonempty
strings keep the wrong panels visible independently of Page data.

## Contract and plan

Tier 2 client rendering correction. Spec approval: not obtained (autonomous
run). Worktree: /private/tmp/kanby-mini-resume-20261128, branch
fix/mini-binding-resume, base origin/main c1af1e7. No new dependencies or server,
database, authentication or automatic-login changes.

- Every dynamic wx:if/wx:elif condition must use WXML expression binding.
- With no error and no pending pairing, neither empty panel is visible.
- An unlinked login shows the returned pairing code; after web binding and a
  successful login, the login/pairing region is hidden and task UI is selected.
- Project, queue, detail, acceptance, attachment and activity visibility follow
  their actual values; no task or accepted card must show an acceptance action.
- Reproduce against the existing template before changing it. Use Page VM data
  and isolated condition-expression evaluation to check state transitions, plus
  a guard for unbound conditional attributes. This is not a WeChat renderer.
- Run existing gauntlet and add a mutation that restores a literal condition.
  Use installed official miniprogram-ci 2.1.31 to compile/upload development
  version 0.1.1 and generate a new preview QR. Preserve urlCheck and the existing
  account binding. No Worker deployment or migration is needed for WXML changes.
- Fetch, merge and push per AGENTS. Record actual results and leave phone
  rendering and interaction acceptance pending until observed on a real device.

Independent fresh-context verification: not performed.

## Evidence and release

Implementation `302feea` corrects all 19 wx:if/wx:elif attributes. No Page
controller, server code, stored credentials or database records were changed.
Before the fix, `npx vitest run tests/weixin-mini-client.test.ts` produced four
new behavioral/contract failures and six passes. After the template change,
all ten client tests passed. The new mutation restores the literal login guard
and is killed by the regression tests.

The final `npm run gauntlet` passed 19/19 layers: 324 tests in 45 files,
116/116 mutations, existing coverage gates, TypeScript, lint, format, shuffled
suite, secret scan, Worker build and schedule checks. Production audit reported
zero vulnerabilities. The isolated expression harness evaluates conditions from
the actual WXML against Page VM state; it is not a full renderer and does not
prove phone layout. No WXML coverage percentage is claimed.

Official miniprogram-ci 2.1.31 compiled and uploaded development version 0.1.1
with robot 1, returning success (15,684-byte upload archive). A separate official
preview also succeeded and generated a new QR code. Private receipts are kept
under ignored outputs/mini-render-fix-20261128/private. The upload command is the
same as miniprogram/README.md with --uv 0.1.1 and the corrected source checkout.

The change is merged/pushed to main. The previously deployed Worker and database
remain at the verified mini release; this client-only correction needs no backend
deployment. Chrome confirmed the user's account already shows linked status.
The existing binding is preserved. Opening the new preview and confirming the
task UI on the user's phone remains pending; KANBY-145 stays open for acceptance.
