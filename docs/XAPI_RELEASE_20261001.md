# Interaction sessions production release — 2026-10-01

`https://kanby.dev` now serves the interaction-session implementation from
`b7259c427a4bce6e73b813f40922141403c44a74` (PR #3). The date here uses
Asia/Shanghai; the platform timestamps are September 30 UTC.

## Artifact and deployment

- Worker: `3ef2459b-f47d-4a59-a46f-8dc132346df4`.
- Production deployment: `c7a62e2e-9e0e-427d-bf1f-9d0927fbd033`.
- Preview deployment: `60693d68-b53d-4eec-8b13-ea6dba731f4b`.
- Both activate artifact `35f08502-0386-4617-8410-d513c9b3b245`, SHA-256
  `96f8ba3e3269555abb8b7046e2b14d6ef467d70167d0d58300c32d9683e095ab`.
- Previous production deployment: `a15ebd06-b1f8-4426-a79e-7e7a0e9ae18c`,
  artifact `8c74910f-55b3-478e-86f7-a516eec8f204`.

The application was built from a clean Git export with the installed lockfile
dependency tree, `KANBY_XAPI=1`, and `KANBY_PUBLIC_ORIGIN=https://kanby.dev`.
Local `.env` files were excluded: they inject native Cloudflare configuration
that the xAPI artifact preflight correctly rejects. Runtime credentials remain
in existing xAPI Secrets. Wrangler was used only for dry-run packaging. Both
environment plans passed with no blocked actions or resource/budget changes.
The release used xapi-to 0.1.23 and the documented deployment primitive to
activate the exact preview-tested artifact in production.

## Migration and recovery

Migration `0016_interaction_sessions.sql` was applied to each environment through
the existing protected maintenance artifact. Its SQL and `d1_migrations` entry
committed in one batch; replay returned success without duplicate execution.
Preview previously had its schema but no D1 migration journal, so the journal
was created there without inventing records for earlier migrations.

Production recovery scheduling was paused during maintenance. Before applying
0016, the production database was backed up: 31 tables and 31,858 rows, including
122 tasks. After migration, all 28 pre-existing business tables matched their
backups by row count and complete canonical row content. The migration journal,
import journal and SQLite sequence metadata were excluded from that comparison
because the migration changes them. Collection starts at
`2026-10-01T02:04:14+08:00`; older activity was not backfilled.

Both environments are ACTIVE with the normal artifact, ACTIVE storage/domain
records, and no migration secrets. The normal artifact contains no migration
route; GET and POST `/__kanby_migration` return 404. Production schedule
`6976939e-5a83-482b-907d-f2151b68e22d` is enabled again for `*/10 * * * *`.
Immediate recovery run `cba2a978-de5e-415e-b7cb-650a2e3265ac` succeeded.

Private backups, migration batches, deployment responses and verification
results are retained under the ignored, access-restricted
`outputs/xapi-release-20261001/private/` directory. Code rollback does not undo
the additive migration or subsequent session data. Legacy routing and its
retained original storage were not changed.

## Verification and limits

- [Merged application CI](https://github.com/AmazingAng/kanby/actions/runs/36739134943)
  passed. Feature test and mutation evidence remains in
  [interaction-sessions-evidence.md](interaction-sessions-evidence.md).
- A synthetic preview project passed the real CLI start, prompt, heartbeat,
  wait, reply, end, get, events, list and report flow. The report counted one
  Agent-reported response and zero verified-user responses. The test credential
  expires after two hours; no production business data was copied to preview.
- Production passed 13 HTTP checks and three static-asset checks. Authenticated
  session listing, session reports, activity and team metrics returned 200.
  Unauthenticated session access and unsigned recovery requests were rejected.
  Public pages and the canonical OAuth callback redirect passed.
- Completed interactive GitHub sign-in and browser-authenticated human replies
  were not exercised. The recovery check confirms an immediate run, not a future
  scheduled invocation. Session collection still requires an instrumented CLI,
  skill or client; deployment alone does not capture every Agent application.
