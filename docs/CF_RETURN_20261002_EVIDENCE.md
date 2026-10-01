# Native Cloudflare return: preparation evidence

Status: **blocked before remote cutover**. No new production database, Worker,
domain attachment or DNS change has been made. The currently unavailable xAPI
service has not been replaced with a stale backup.

Spec: [CF_RETURN_20261002_SPEC.md](CF_RETURN_20261002_SPEC.md).
Spec approval: not obtained (autonomous run). Independent verification: not
performed. Application source is unchanged from `33df673`; preparation spec
commit is `5388460`.

## Verified preparation

- `npm run gauntlet`: 16/16 layers passed; 35 test files, 236 tests; 85/85
  mutants killed. The configured production audit threshold is high. It
  reported one moderate `hono` advisory (`GHSA-hxh3-vqpv-xpqv`); this result is
  not a zero-vulnerability audit. No dependency or audit threshold was changed.
- Native Worker build from a clean Git export passed. The isolated build has no
  copied `.env` file and uses placeholder target resource identifiers pending
  discovery of the production account. Wrangler dry-run packaging passed.
- All 17 migrations through `0016_interaction_sessions.sql` applied to the
  isolated local D1. Native local HTTP checks passed: `/` and `/demo` 200,
  unauthenticated `/api/v1/sessions` 401, `/__kanby_migration` 404.
- Retained native Worker code, settings, deployments, schedules and domain
  inventory were backed up. Its old D1 was exported using Wrangler and restored
  into local SQLite; foreign-key check returned zero violations. It contains
  109 tasks and retains 87 cutover write guards. It is not the latest source.

Private artifacts and command logs are retained under the access-restricted,
Git-ignored `outputs/cf-return-20261002/private/` directory. No credential or
database contents are included here. The temporary local server was stopped.

## Access blocker

The xAPI Worker management endpoint returns 404. Both `kanby.dev` and the managed
Worker hostname return 503 with `workers_postpaid_state_unavailable`; the legacy
native API proxy forwards that failure. Neither path currently permits exporting
the authoritative live database.

The existing Wrangler login accesses account
`4592ac4d37d07944e6abee1c15a6cc00` (0xAA), which contains the retained legacy
`kanby-db` but not the `kanby.dev` zone. The related backend's local configuration
accesses test account `7c68d43b895e9eb92d129f79dd359479`; its token was rejected
with HTTP 401 when reading documented production account
`65a9625cc761066e6f17bd3634cc5cc2`.

Production-account credentials or an authorized current-source export/access
path are still required. The October 1 pre-release backup is also not evidence
of the latest source state. Current-source export, quiescing, restore rehearsal,
full table and attachment comparison, native publication, domain cutover and
live acceptance remain unperformed. Continue from the prepared build after
resolving access; do not mark this migration complete.

## Reproduction references

- Application checks: `npm ci && npm run gauntlet`.
- Native build and local migrations: [Cloudflare deployment guide](CLOUDFLARE_DEPLOY.md).
- Export/import procedure: [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
- Domain binding procedure: [Cloudflare Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Operational reads depend on account access and private snapshots and cannot be
reproduced from the public repository alone. Migration-specific negative
controls, checksum comparison and attachment transfer have not yet run; the
application gauntlet does not substitute for those checks.
