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
