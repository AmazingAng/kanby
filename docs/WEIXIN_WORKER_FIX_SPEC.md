# WeChat Worker redirect compatibility

Tier 3 scoped transport/auth fix. Spec approval: not obtained (autonomous run).
User authorized configuring their WeChat binding and routine merge/push/deploy.
Isolation: existing clean deployment worktree, branch fix/weixin-worker-redirect,
starting at 89a1fa1; locked node_modules retained, no local .env copied.

Acceptance:

- QR generation succeeds when fetch implements Workers' redirect modes (manual
  and follow only). Existing QR/confirm/sync/send flow continues to pass.
- All 301/302/303/307/308 responses from authenticated iLink requests fail closed
  without following Location, including arbitrary untrusted HTTPS destinations.
- Keep host allowlist, authentication, encryption, public API and database intact.

Failure model: unsupported redirect mode prevents QR generation; automatic
redirects expose bot credentials; accepting redirect bodies treats failures as
success. Regressions cover each, with executable mutants for all three.

Files: lib/weixin-ilink.ts; tests/weixin.test.ts;
tests/weixin-transport.test.ts; tools/mutants.mjs; this spec and
WEIXIN_WORKER_FIX_EVIDENCE.md. No new dependencies. Run npm run gauntlet including
full/randomized suites, static checks, mutation, audit and Worker build. Preserve
existing tests. Use preview synthetic fixture only for transport smoke, then
promote tested artifact to production and obtain real QR through user's Chrome
session. No schema/resource/secret changes. Real scan and activation require user.
Commit spec, fetch before merging, merge/push main without force or bypasses.

Amendment: Worker-semantics regression also reproduced the identical bug in
lib/notifications.ts (fallback webhook delivery). Include that transport fix;
verify fallback delivery succeeds and redirect responses fail without forwarding
notification text or webhook secrets. Add regression and transport mutants.
