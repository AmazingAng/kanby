# Return Kanby to xAPI — 2026-10-12

The user authorizes redeployment of Kanby at kanby.dev now that xAPI Workers
has recovered. Preserve both the recovered xAPI history and any writes accepted
by the native Cloudflare service since its October 8 activation.

Spec approval: not obtained (autonomous run); deployment and routine commit /
merge / push are user-authorized. Independent verification: not performed.
Use branch `codex/xapi-return-20261012`, existing pinned application dependencies,
and an isolated clean build. xAPI CLI may be updated in npm's cache to use the
repaired platform's published interface; no new application dependency planned.
Private exports, credentials and operation logs stay in ignored outputs.

## Acceptance and failure model

1. Inspect deployed artifacts, resources, schedules and domains. Back up both
   databases and native Worker code/settings before mutation. Confirm attachment
   inventory rather than assuming previous empty storage remains empty.
2. Quiesce both sides for the final snapshot, including schedules and database
   guards against already admitted native requests. Use the existing temporary
   maintenance artifact with short-lived migration credentials on xAPI only if
   the platform has no suitable database export facility.
3. Compare both databases with the October 1 common baseline. Preserve one-sided
   changes and new rows. Reconcile independent histories using actual row keys;
   do not choose a whole database based on a timestamp. Material conflicting
   business edits require a concrete resolution before production import.
4. Locally rehearse the exact import and verify full data, sequence values,
   foreign keys and history. Preserve journal events without firing duplicate
   history triggers. Use snapshot-specific atomic idempotent batches. Copy any
   attachment bytes and verify checksums before accepting production writes.
5. Run required checks and test the exact normal artifact in preview without
   production customer data. Activate that artifact in production only after
   migration verification. Verify canonical pages, authentication boundaries,
   task/session writes and persisted reads using isolated synthetic fixtures.
6. Remove migration routes and credentials. Make kanby.dev the single writable
   service; retain native data for rollback and route old clients to the canonical
   service. Verify routing without following authenticated redirects blindly.
7. Configure at most one recovery schedule after checking GitHub integration and
   delivery state. Preserve current secrets and domain bindings where possible.
   Record unverified interactive login or integration behavior explicitly.

Code rollback does not reverse data migration. If cutover fails before production
writes resume, restore the prior service with its intact data; after writes resume,
rollback must preserve/reconcile those writes. A failing gate must be addressed or
reported, never bypassed. Commit final evidence, fetch latest remote state, merge
into main and push under AGENTS.md.
