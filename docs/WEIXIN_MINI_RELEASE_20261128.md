# Registered WeChat mini program release — 2026-11-28

KANBY-145 now has a configured and deployed backend and an uploaded WeChat
development version. AppID: `wx358a6eafff0c9884`; implementation/configuration:
`1c75053`. The user provided AppSecret through ignored .env and the separate
code-upload RSA key through an ignored root-level .key file. Neither credential
was copied into the build worktree, client source, Git or displayed output.

Scope follows the appended deployment section of WEIXIN_MINI_SPEC.md. Spec
approval: not obtained (autonomous run). Independent verification: not performed.
The existing authentication implementation and migration were not changed.

## Source and local checks

The clean worktree `/private/tmp/kanby-mini-release-20261128` ran
`KANBY_XAPI=1 KANBY_PUBLIC_ORIGIN=https://kanby.dev npm run gauntlet` successfully:
19/19 layers; 320 tests in 45 files; 115/115 mutants; TypeScript, lint, format,
coverage gates, secret scanner, shuffled suite, Worker build and scheduler check.
Production dependency audit: zero vulnerabilities. The later CI documentation
addition passed formatting and diff checks separately; no runtime code changed.

The exact AppSecret and upload private key were checked absent from 231 generated
build/client files. The public AppID is intentionally committed. Runtime bindings
WEIXIN_MINI_APP_ID and WEIXIN_MINI_APP_SECRET are present in both environments;
the latter is stored only as a server secret. No application dependencies changed.

## Database and Worker release

The existing authenticated maintenance artifact
`e37d19c6-823c-4189-a98b-15860281dcf9` was temporarily activated with fresh,
one-hour credentials. Ordinary writes were denied and scheduled recovery was
paused during the production snapshot/migration window. Each environment was
privately backed up and reconstructed in SQLite before applying unchanged 0020.
Both local rehearsals passed foreign-key checks; an intentionally altered task
row proved the data-comparison check fails on unexpected changes.

- Preview: 41 tables / 68 rows before, 45 tables / 70 rows after; one task.
- Production: 40 tables / 52,523 rows before, 44 tables / 52,525 rows after;
  167 tasks and one attachment record preserved.
- Every existing business row matched the local rehearsal exactly. The four
  mini tables were added; migration and import journals account for new rows.
- Atomic migration application and identical-request replay both succeeded.
- D1/R2 resource identities were unchanged. No attachment files were modified.

Normal immutable artifact `05c1f76e-a7ee-4115-ab1b-995370aa68b4`, SHA-256
`5c6cc64a9f77227a7bb4358a709f278098ca2761ebbe7d0446cfd3fdb5ddb4a9`, was verified
in preview and activated unchanged in production:

- Preview deployment: `df4a0d07-95ae-46c9-bde0-8249d0bd8762`, ACTIVE.
- Production deployment: `040f92c4-e680-4f86-ab74-e2b7298cf8f5`, ACTIVE.
- Worker: `3ef2459b-f47d-4a59-a46f-8dc132346df4`; domain: `https://kanby.dev`.

Both environments verified /mini (200), unauthenticated mini tasks (401),
unauthenticated browser binding API (403), invalid login code (502), unknown
auth action (400), unauthenticated Agent tasks (401), and removed migration
endpoint (404). All mini API responses used no-store. The deliberate invalid-code
test exercises the configured error path; it does not prove a real wx.login code
exchange. Existing Agent authentication still identifies the xAPI project.
Chrome showed the live binding page with the current user's account and pairing
input. No account was linked on the user's behalf.

Temporary migration bindings were deleted in both environments. Exactly one
production native schedule is enabled; preview and legacy HTTP schedules remain
paused. Private backups and receipts are in ignored release outputs. Rollback
may restore the previous avatar artifact while leaving additive mini tables in
place; do not restore an old database over newer writes.

## Official CI upload and remaining acceptance

The user's requested `miniprogram-ci@2.1.31` (MIT) was installed in an isolated
operational directory, outside the application's dependency tree. The
reproducible upload command is in miniprogram/README.md. Upload uses only the
miniprogram directory, excludes README/keys/env files, and preserves urlCheck.

Official compilation succeeded. The first upload was rejected with invalid IP;
the user added the reported egress address to WeChat's code-upload whitelist.
Retry completed successfully with version `0.1.0`, robot 1, and a 15,681-byte
upload archive. Official CI preview also succeeded and produced a 470 × 470 JPEG
QR code. These are development/preview operations, not review or public release.
The user confirmed adding `https://kanby.dev` as a request domain; this is
user-reported configuration, not independently inspected platform state.

Still pending: scanning on a real phone, successful wx.login exchange, explicit
binding to the existing Kanby account, task/comment/checklist/acceptance flows,
and any platform filing, privacy, classification, review and formal release
requirements. Notification links continue to use the website. KANBY-145 remains
open for real-device and human acceptance.
