# Turn collaboration release — 2026-11-28

Source candidate: `df62cc4`; user authorized merging and redeploying after review.
Tier 3 operational release: schema changes, credentials and production data.
Spec approval: not obtained (autonomous run); merge and deployment authorized.
No application implementation changes are planned. Independent verification is
not performed; prior review and this release share conversation context.

Use an isolated checkout without local `.env` files and install locked packages.
Run `npm run gauntlet`, fetch before merging and push main without force.
Apply migrations 0017–0019 first to preview, then production, using the existing
short-lived authenticated maintenance endpoint. Pause recovery schedules during
maintenance and back up each database after ordinary writes stop. Rehearse the
SQL on a local copy and compare all business rows with the expected migration
result; preserve IDs, attachments and existing credentials. Never replace data
with an older snapshot. Migration batch IDs are stable and replay-safe.

Provision distinct WeChat credential keys only where missing. Do not rotate an
existing key. Promote the exact preview-tested normal artifact to production.
Check pages/assets, OAuth initiation, API authentication, turn queue and migrated
schema. Exercise collaboration operations with an isolated preview fixture.
Remove temporary migration secrets, confirm the migration route is absent,
revoke preview test credentials and leave exactly one production recovery cron.
Retain backups and the previous artifact for rollback; rollback code without
removing additive tables/columns. Do not send chat notifications during tests.

Interactive GitHub consent, real WeChat QR binding/delivery, delayed delivery
and npm package publication are outside this deployment verification. Record
these limits, actual checks, resource identities and deployment receipts in
`docs/RELEASE_20261128_EVIDENCE.md`. Private records stay under ignored
`outputs/release-20261128/private/`; no new dependencies or production data in Git.
