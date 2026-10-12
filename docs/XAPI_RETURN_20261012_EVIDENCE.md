# Kanby return to xAPI — 2026-10-12

Kanby is writable at <https://kanby.dev> on the restored xAPI platform. Data from
both the recovered xAPI service and the native Cloudflare recovery service was
merged and verified before returning production traffic. The native address
now redirects browsers and proxies API requests to the canonical service.

Specification: [XAPI_RETURN_20261012_SPEC.md](XAPI_RETURN_20261012_SPEC.md).
Spec approval: not obtained (autonomous run); deployment, data preservation and
routine Git workflow were user-authorized. Independent fresh-context verification
was not performed. No application code or dependency versions changed in this
release; source build is `8c848e2`, with application code from `205d19c`.

## Deployment

- xAPI Worker: `3ef2459b-f47d-4a59-a46f-8dc132346df4` (`kanby`).
- Canonical domain: `kanby.dev`; fallback hostname:
  `kanby-3ef2459bf47d.xapi.men`. Existing domain bindings were retained.
- Exact artifact verified in preview and activated in production:
  `c441b4ae-cb4e-4533-a512-cc3aef9a7e77`.
- Artifact SHA-256:
  `ffb9c12e4c4ee96713c49dd0bb3b0154b3e9af3c771526a10def7272d19e79dd`.
- Final production deployment: `04ce1fe5-0148-40bd-94f6-e21fe3f58387`.
- Final preview deployment: `9fb53142-c974-424d-88e0-0d4213c25ad2`.
- Production D1 resource: `f498c964-58ed-4f55-bfe7-b85942b35e62`;
  provider D1: `ab4b9b1a-eb78-40a6-96de-a8bce841e19b`.
- Production R2 resource: `df0ebbb6-004a-4ded-badd-852d8ebee479`;
  provider bucket: `xapi-3ef2459bf47d-r-attachments`.
- CLI: `xapi-to@0.2.0`; Wrangler: pinned 4.131.0. Existing budgets,
  authentication secrets, resources and domains were preserved.

The application was built from a clean Git export with the locked installed
toolchain and no copied `.env` files. `KANBY_XAPI=1` and
`KANBY_PUBLIC_ORIGIN=https://kanby.dev` enable the existing adapter. Normal
builds have no recovery label or migration route. `workers plan` accepted both
environments; `push` deployed preview and `promote --artifact` activated the
same tested artifact in production. Maintenance and final activations used
explicit artifact IDs with stable per-operation idempotency keys.

## Data reconciliation and safety

Backed up both database states and the native Worker's code, settings, deployment
history and schedules. Recorded the existing xAPI deployment before changing it.
Paused the existing recovery schedule and used the temporary maintenance artifact
with a short-lived migration token to export the recovered xAPI database.

The native service entered maintenance before its final snapshot. All 33 tables
received INSERT/UPDATE/DELETE guards, including protection against previously
admitted requests. The guarded database and previous native archives remain
intact. Both origins temporarily rejected ordinary application requests during
migration and fixture cleanup.

Reconciled both snapshots against the October 1 common backup:

- Recovered xAPI: **34 tables / 31,873 rows / 122 tasks**.
- Final native snapshot: **34 tables / 40,147 rows / 124 tasks**.
- Merged contents: **34 tables / 40,160 rows / 124 tasks**, before new import
  journal entries. Both sides had **zero attachment records** and no interaction
  sessions, so no historical attachment bytes or session events needed copying.
- Preserved the native task edits, two new tasks, Agent updates and later GitHub
  activity, plus the six additional GitHub deliveries and six events held by xAPI.
- No conflicting business edits or deletions. Two metadata differences were
  resolved by retaining the original xAPI 0016 migration journal timestamp and
  its original interaction collection start. No session history was fabricated.

Locally replayed the exact import against a faithful destination copy with foreign
keys enabled. History triggers were removed for data replacement and restored
afterward, avoiding fabricated task/member metric events. Schema definitions,
row keys, full canonical row contents and SQLite sequences were checked. A
same-row-count title mutation was rejected by the comparison negative control.

Imported **29 atomic batches** through the temporary endpoint, with snapshot-specific
IDs and content digests. Replaying the first batch returned the expected replay
result. A fresh target export matched every table and sequence, including the 29
new journal rows: **40,189 rows**, foreign-key check clean. Production data was
never copied to preview.

After production smoke tests, removed only the isolated test project's owned
records and its R2 test object, then exported again during maintenance. All
business-table contents still exactly matched the verified import. The resulting
**40,191 rows** include two additional fixture/cleanup import journal entries;
metric sequence advances were retained. Production subsequently resumed normal
writes and GitHub recovery, so later live data can legitimately change.

## Runtime and release verification

- `npm run gauntlet`: **17/17 layers**, **244 tests / 36 files**, **90/90 mutants**.
  Types, lint, formatting, coverage, randomized test order, secret scan, CLI
  package checks, production build and schedule checks passed.
- Production dependency audit: **0 findings**. Development dependencies were not
  updated or newly audited in full; the prior development-tool caveats in the
  [October 8 report](CF_WRITE_20261008_EVIDENCE.md) are not claimed resolved.
- **26 live HTTP checks in each environment** (52 total) exercised normal pages,
  OAuth initiation, authentication rejection, signed browser task create/update/
  readback, cross-origin rejection, attachment upload/download/delete, Agent task
  writes, session start/wait/reply/end, persisted events, `verified_user` review
  provenance, closed-session rejection and the absent migration route.
- Browser API checks used short-lived synthetic signed sessions and isolated
  project credentials. They verify the deployed authentication/write paths;
  completed interactive GitHub consent was not manually exercised.
- **4 actual production CLI commands** verified session start/end/readback and
  task listing against `https://kanby.dev`.
- **18 final HTTP probes** checked canonical pages, four referenced static assets,
  exact native navigation/auth redirects, direct/proxied unauthorized API and
  webhook rejection, absent migration routes, and rejected deleted test tokens.
- Final xAPI inspection confirmed the exact artifact, ACTIVE deployments,
  ACTIVE D1/R2/domain resources and absence of both temporary migration secrets
  in preview and production. Local temporary tokens were removed after testing.

No new application tests were added for this deployment-only change: existing
normal/recovery/migration/proxy contracts ran, supplemented by database rehearsal
and live operations. The operational checks share the implementer's context and
are not independent verification.

## Routing and a single recovery schedule

Native Worker bridge version: `23a9f1f4-d1fc-4fdb-8d70-c1dd1ebf2b74`. It uses the
existing tested `tools/legacy-worker-redirect.mjs`: browser paths/query strings
redirect to `kanby.dev`; API requests preserve authorization and body bytes and
do not follow upstream redirects. Native schedules are empty. The former native
D1 `d5436e67-4784-416a-9e78-b2029a78a79d` retains all 99 `_kanby_return_*` guards.

CLI 0.2.0 now imports supported Wrangler crons as platform schedules invoking
`scheduled()`. This differs from the old deployment guide. Inspection caught
new production and preview schedules alongside the legacy HTTP schedule.
Paused the legacy HTTP schedule and preview schedule, leaving exactly one enabled
production schedule: `29c4626a-1f34-8eb3-a6c2-231c81936ce0`, every 10 minutes.
Its immediate run `51f19b56-5aa8-49b4-a5ab-49b7092294c0` **SUCCEEDED / HTTP 200**.
The legacy HTTP run also passed before it was paused. Neither immediate test is
proof of future periodic execution. The deployment guide now documents automatic
cron import and checking for unwanted preview/duplicate schedules after pushes.

## Repairs, limitations and rollback

The initial type check included a previous ignored build's temporary metadata
instrumentation and failed on its untyped plugin parameters. Restored that generated
configuration from its original commit and reran the complete gauntlet successfully;
no tracked implementation or check threshold was changed. CLI 0.2.0 required the
generated Wrangler file before the first plan, so the clean build was generated
first. A just-activated maintenance route briefly returned the previous artifact's
404; bounded read retries confirmed actual routing before migration requests.
One Python default-user-agent health probe was rejected; browser-like and Node
requests subsequently passed. The CLI schedule list now returns an array, and
the inspection script was adapted before verifying enabled schedules.

Keep all source and final backups. Do not remove native write guards or restore
a second writable instance as a code rollback: writes accepted after cutover must
be retained or reverse-migrated first. xAPI code rollback should continue using
the reconciled database. The normal artifact contains no SQL migration endpoint;
reopening maintenance access requires a new explicitly scoped operation.

Private snapshots, schema/data manifests, exact batch plans, live test evidence,
and operation logs are stored in ignored, access-restricted
`outputs/xapi-return-20261012/private/`. No customer records or credentials are
committed. Operational reproduction requires those artifacts and account access;
repository checks are reproducible with `npm ci && npm run gauntlet`. Current
release steps are in [XAPI_DEPLOY.md](XAPI_DEPLOY.md).
