# Native Cloudflare read-only recovery — 2026-10-02

The user authorized restoring the October 1 backup as a **read-only recovery
preview** at <https://kanby.0xaa.workers.dev>, while current-source access is
unavailable. That interim service is deployed and verified. Copying the latest
xAPI data, reopening writes and switching `kanby.dev` remain deferred.

Spec: [CF_RETURN_20261002_SPEC.md](CF_RETURN_20261002_SPEC.md). The initial spec
was not separately approved (autonomous run); the user explicitly selected the
subsequent read-only backup recovery option. Independent fresh-context
verification was not performed.

## Native deployment

- Source implementation: `897b6fa`.
- Cloudflare account: `4592ac4d37d07944e6abee1c15a6cc00` (0xAA).
- Native Worker: `kanby`; URL: `https://kanby.0xaa.workers.dev`.
- Worker version: `179f9637-be3f-410e-bf04-6ee9688123e6`.
- New D1: `kanby-db-native-20261002`, ID
  `5b8406e6-563e-4e79-bf57-f8211adbaba3`.
- New R2: `kanby-attachments-native-20261002`.
- Origin: `https://kanby.0xaa.workers.dev`; existing Worker secrets retained.
- Build-time recovery label: `KANBY_RECOVERY_SNAPSHOT='2026-10-01 备份'`.
- Native cron: disabled; the generated scheduled handler also refuses work.

The old native bridge was replaced with the native application, eliminating its
forwarding dependency on unavailable xAPI runtime dispatch. The original native
D1/R2 and the xAPI resources were retained. No `kanby.dev` DNS or domain binding
was changed. The application was built from a clean Git export without copied
`.env` files, using the pinned installed dependency tree and Wrangler 4.131.0.

## Backup restoration and write protection

The selected source is the October 1 pre-migration backup retained at
`outputs/xapi-release-20261001/private/production-before-db.json`. It contains
122 tasks and no attachment records. It does not include activity after that
snapshot or the subsequently introduced interaction-session tables. This is
explicitly not a current-source export.

Restoration preserves original data, IDs, timestamps, schema objects and
sequence values. Tables and data are restored before history triggers to avoid
fabricating metric events. The additive 0016 schema and its journal entry were
then initialized for application compatibility; no missing session events were
invented. The recovery collection timestamp describes initialization of the
empty recovery session schema, not historical coverage.

A local SQLite rehearsal passed, including foreign-key validation and replay
of the exact SQL file in dependency order. A same-row-count title modification
was rejected by the content comparison negative control. All 33 application
and bookkeeping tables received INSERT/UPDATE/DELETE guards: 99 guards total.
A direct remote D1 UPDATE was rejected with `KANBY_RECOVERY_READ_ONLY`.

Independent exports of the new native D1, both before publication and after
live acceptance checks, matched the expected full canonical contents of **34
tables including SQLite sequences, 31,860 rows**. Both exports passed foreign-key
checks and retained all 99 write guards. The two added rows relative to the
backup are the migration journal and recovery collection records.

HTTP writes and side-effectful or unknown API reads are rejected. Cookie-only
logout remains available. Agent reads do not update token timestamps. Existing
project members can authenticate without updating users or accepting invitations;
new members are rejected in recovery mode. Every rendered page displays the
backup label and read-only notice. Database guards provide a separate boundary
against an accidentally exposed write path.

## Verification

- `npm run gauntlet`: **17/17 layers**, 36 files / **244 tests**, **90/90 mutants**.
- `npm run test:recovery`: 8 tests; recovery helper coverage 100% statements
  (10/10), branches (13/13), functions (2/2) and lines (8/8). This quantitative
  coverage applies to the two recovery helpers; other changed authentication
  paths and the generated Worker are integration-tested.
- Six new behavioral tests failed before implementation, then passed. Five added
  mutants were killed: HTTP write bypass, Agent timestamp writes, OAuth
  registration, missing membership enforcement and scheduled invocation bypass.
- The generated Worker was executed in normal and recovery modes to verify both
  HTTP dispatch and scheduled-handler behavior. Recovery build configuration
  contains no cron and no migration import route.
- **24 live HTTP checks** passed: three labelled pages, static assets,
  unauthenticated rejection, authenticated projects/tasks/session/report/activity
  reads, browser and Agent write rejection, blocked webhook/recovery/setup,
  missing migration endpoint, and OAuth initiation with the native callback.
- Cloudflare settings confirmed the intended D1/R2, retained authentication
  secrets and empty native schedule list. Post-check database export proved the
  accepted reads and rejected writes left snapshot contents unchanged.

Initial repairs: the restore rehearsal needed foreign-key-aware ordering;
TypeScript required an explicit parsed-response type in a test; lint required a
semantic `output` element for the status banner. An API-based paged verification
encountered a connection reset and was replaced with native D1 full exports plus
local comparison. No assertion or check threshold was weakened.

## Limits and resumption

Completed interactive GitHub sign-in was not exercised. OAuth initiation uses
`https://kanby.0xaa.workers.dev/api/auth/github/callback`; the GitHub OAuth App
must allow that callback for a fresh login. The existing Agent credential was
verified against the deployed service. Production dependency audit reported one
moderate Hono advisory (`GHSA-hxh3-vqpv-xpqv`); the configured high-severity gate
passed, which is not a zero-vulnerability claim. No dependency was changed.

The xAPI management endpoint returns 404 and runtime dispatch returns 503
`workers_postpaid_state_unavailable`. The native login accesses 0xAA only; the
related backend's local configuration accesses test account
`7c68d43b895e9eb92d129f79dd359479`, and its token was rejected by documented
production account `65a9625cc761066e6f17bd3634cc5cc2`. Current-source access is
still needed before copying newer records. Do not remove write guards or rebuild
without the recovery label as a substitute for that migration.

Once access is available: quiesce the current source, export it, restore into
another target database, compare all data and attachments, verify normal-mode
application behavior, then switch the native Worker binding and enable one
recovery schedule. Keep this recovery database for rollback. Canonical-domain
routing requires a separate verified change when its account is accessible.

Private backups, import SQL, manifests and deployment logs remain in the
access-restricted ignored `outputs/cf-return-20261002/private/` directory. No
credential or customer data is committed. Operational evidence depends on these
private snapshots and account access and is not reproducible from the public
repository alone. Application checks are reproducible with `npm ci && npm run
gauntlet`; native build steps are in [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md).
