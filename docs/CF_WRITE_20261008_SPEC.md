# Native Cloudflare writable recovery — 2026-10-08 specification

The user explicitly requested writes on the existing recovered service. This
supersedes the October 2 restriction to wait for current-source access. The
October 1 snapshot remains the historical baseline; later xAPI data is missing.

Spec approval: not obtained (autonomous run); deployment/writes authorized by
“要也能写入”. Independent verification: not performed. Use the existing tools
and dependencies, a `codex/native-writable-20261008` branch, private ignored
operational snapshots, and a clean source export for the build. Commit the
specification and final evidence, merge and push main under AGENTS.md.

## Acceptance and failure model

1. Preserve the current Worker artifact/settings and a fresh export of the
   guarded native D1. Keep that database intact for archival recovery.
2. Restore a new D1 with identical schema/data/sequences except the 99 named
   recovery write-guard triggers. Full content comparison, foreign-key check
   and a deliberately changed-row negative control detect incomplete copying.
3. Build without recovery mode, bind the new D1 and existing native R2, preserve
   authentication secrets and native origin, and deploy at
   `https://kanby.0xaa.workers.dev`. No canonical-domain change or new dependency.
4. Verify normal/recovery regression tests and the production build. Verify live
   authenticated browser task writes, Agent task/session writes and subsequent
   reads in an isolated synthetic project. Unauthorized requests must remain
   rejected. Remove only owned synthetic fixtures after recording evidence.
5. Keep periodic GitHub recovery paused for this activation: replaying an old
   snapshot against GitHub is separate from enabling user-requested writes.
6. Keep backups and document the new writable baseline. Future xAPI recovery
   must reconcile with these new writes, never overwrite them. After user writes
   begin, rollback must preserve the writable database; the archived read-only
   database is not a lossless rollback target.

No application behavior change is planned: existing normal-mode behavior is
being deployed. Coverage/mutation/property checks apply to existing recovery
regressions; operational safety is checked by export/replay and live requests.
Interactive GitHub consent and unavailable historical xAPI data are outside what
synthetic authentication and snapshot comparison can prove.

## Addendum: release audit discovered during execution

The unchanged dependency tree failed today's high-severity production audit
(13 findings: 1 moderate, 11 high, 1 critical). Address available compatible
transitive fixes in `package-lock.json`; classify `vinext` and `shadcn` as build
and generation tools in `package.json` devDependencies. Their pinned versions
stay unchanged. No new direct dependency or audit-threshold exception is added.
Verify actual Worker module inputs do not include vulnerable build-only glob
walkers. The unpatched braces advisory remains a disclosed development/build
risk; only trusted repository paths are used for this build. Repeat the full
gauntlet and rebuild the deployment with the final locked dependency tree.
