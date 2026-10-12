# xAPI Workers deployment

Kanby is deployed at <https://kanby.dev> on xAPI Workers. The October 12 return
merged the recovered xAPI database with new writes from native Cloudflare; see
[cutover evidence](XAPI_RETURN_20261012_EVIDENCE.md). The previous native Worker
redirects browser navigation and proxies API requests to this canonical service.
Its retained database is guarded against writes. Do not reactivate a second
writable copy without reconciling data.

The checked-in `xapi.worker.json` targets Worker
`3ef2459b-f47d-4a59-a46f-8dc132346df4` on `api.xapi.to`. Preview and production
have separate D1/R2 resources. Keep customer data out of preview.

Use Node.js 22.13+, the pinned dependency tree (`npm ci`, including development
build tools), and `xapi-to@0.2.0`. Authenticate with a key scoped to
`workers:read` and `workers:write`, stored in CLI configuration or environment.
Build in a clean checkout without the old native deployment's ignored `.env`
files. The CLI reads the Wrangler path before its planned build, so generate
`dist/server/wrangler.json` once before the initial plan:

```sh
npm run gauntlet
KANBY_XAPI=1 KANBY_PUBLIC_ORIGIN=https://kanby.dev npm run build
npx xapi-to@0.2.0 workers plan --env preview
npx xapi-to@0.2.0 workers push --env preview --non-interactive
npx xapi-to@0.2.0 workers promote --to production \
  --artifact <verified-preview-artifact-id> --non-interactive
```

The manifest packages both Worker modules and static assets. It compiles
`KANBY_PUBLIC_ORIGIN=https://kanby.dev`; a runtime `PUBLIC_APP_ORIGIN`, if present,
takes precedence and must pass origin validation. Keep recovery/migration flags
unset for normal builds. GitHub credentials and session secrets remain runtime
bindings per environment. Normalize escaped newlines in the GitHub PEM before
sending it through stdin; never print credentials or put them in command arguments.

Wrangler `deploy --dry-run` is a local packaging step. The immutable xAPI artifact
accepted in preview must be the artifact activated in production. Do not deploy
this managed Worker directly through Cloudflare. Native self-hosting instructions
remain in [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md).

## Platform recovery

In xapi-to 0.1.23, `promoteWorkerProject` passes `retentionPriceVersion` to resource provisioning but omits it from `ensureActiveDeployment`. Initial production activation can therefore fail with `retention_quote_acceptance_required` even after policy acceptance. After production preflight and resource readiness, use the documented `workers deploy` primitive with the exact tested preview artifact ID, compatibility date `2026-09-10`, flag `nodejs_compat`, a stable idempotency key and the accepted retention price version. Reconcile deployment state before retrying; reuse an idempotency key only for identical inputs.

If R2 reports `R2_EVENT_CAPTURE_NOT_READY`, wait until its returned retry time, then retry resource creation with the same Worker, environment, binding and placement. Preserve the existing bucket, queue and reserve. Resource ACTIVE, application health and successful persisted operations are separate checks.

Retention-v3 uses environment reserves and manual recovery. Cleanup can begin at the reserve cleanup threshold, including when account funds remain. Deposits do not automatically replenish reserves. A reserve is not a consumption charge; inspect current quotes and billing freshness before drawing cost conclusions.

## Database migration

Normal builds contain no SQL import route. A temporary maintenance build is enabled only when both `KANBY_XAPI=1` and `KANBY_MIGRATION=1` are set. It serves `/demo` for deployment health and denies ordinary application traffic with 503.

The temporary `/__kanby_migration` endpoint requires a randomly generated runtime `KANBY_MIGRATION_TOKEN` of at least 64 characters and `KANBY_MIGRATION_EXPIRES` as a future Unix timestamp in milliseconds. Use a short expiry, send the bearer token only to the intended environment's HTTPS hostname and keep exports/credentials in a private directory outside Git.

Use batch IDs namespaced by the snapshot identity so subsequent snapshots cannot collide with the earlier import journal. Import `{id, statements}` with at most 40 single SQL statements and a 1 MiB request limit. Each batch and its digest marker commit atomically. Identical retries are safe; different contents with the same ID return 409. The authorized `{query: "SELECT ..."}` operation allows verification. Never split SQL merely on semicolons; trigger bodies contain them.

Before cutover, back up the original code, deployment identity and full database. Quiesce source writes and scheduled jobs, then export a final snapshot. Import table definitions, data in foreign-key order, then indexes/views/triggers. Preserve task IDs, users, memberships, token hashes, GitHub records and metric history. Compare every business table's row count and canonical row-content checksum; attachment files require their own byte/checksum verification. Keep the original storage for recovery. A code rollback does not undo migrated data.

Deploy and accept the ordinary artifact in preview, then activate that exact artifact in production. Confirm the import route is absent from the artifact and returns 404. Delete temporary migration bindings after both environments use normal builds. Avoid restoring the old writable service after new production accepts writes without a reverse migration.

## Domain, authentication and scheduling

Before attachment, use `xapi get dns.list` and `xapi call dns.list` to inventory the owned domain. Back up its DNS records and, during the authorized cutover, remove only conflicting apex A/AAAA/CNAME records using stable record IDs and `record_modified_on` checks. Preserve unrelated TXT, mail and subdomain records. A Cloudflare domain conflict can currently quarantine the xAPI environment; do not attempt attachment while conflicting records remain.

Attach the production domain using the combined xAPI command after data verification:

```sh
npx xapi-to@0.2.0 workers domains attach \
  3ef2459b-f47d-4a59-a46f-8dc132346df4 --env production \
  --xdomain-domain-id dom_mtirxgsdc3rf9k2p --subdomain @
```

Verify DNS/TLS, root-relative assets, authenticated metrics/activity and attachment persistence. The OAuth App callback must be `https://kanby.dev/api/auth/github/callback`; the separate GitHub App webhook uses `https://kanby.dev/api/github/webhook`. An OAuth redirect alone does not verify successful sign-in.

In `xapi-to@0.2.0`, supported Wrangler `triggers.crons` are imported as xAPI
platform schedules that invoke the Worker's `scheduled()` handler. Do not also
enable the legacy HTTP `/__kanby_recovery` schedule. The handler internally
signs its call to the existing GitHub recovery route using the environment's
`GITHUB_WEBHOOK_SECRET`; no signature needs to be copied into a schedule body.

The current production schedule `29c4626a-1f34-8eb3-a6c2-231c81936ce0` runs
`*/10 * * * *`. The old HTTP schedule
`6976939e-5a83-482b-907d-f2151b68e22d` and the preview schedule
`214e237a-2aa0-8b39-a2c3-6cc7658302f1` are paused. `push` can re-enable a preview
schedule declared by the generated Wrangler config, so inspect schedules after
each deployment and pause preview recovery for this project. Verify exactly one
production recovery schedule is enabled and native Cloudflare has none:

```sh
npx xapi-to@0.2.0 workers schedules list <worker-id>
npx xapi-to@0.2.0 workers schedules pause <worker-id> <preview-schedule-id>
npx xapi-to@0.2.0 workers schedules run <worker-id> <production-schedule-id>
```

A successful immediate run verifies that invocation, not future cron firing.
