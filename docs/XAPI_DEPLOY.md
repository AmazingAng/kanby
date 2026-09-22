# xAPI Workers deployment

The target canonical service is `https://kanby.dev`. See [current acceptance and blockers](XAPI_DEPLOYMENT_EVIDENCE.md) before promoting or changing live routing. The checked-in `xapi.worker.json` targets Worker `3ef2459b-f47d-4a59-a46f-8dc132346df4` on `api.xapi.to`. Preview and production have separate D1 and R2 resources. Keep production data out of preview.

Use Node.js 22.13+ and the pinned dependency tree (`npm ci`). The deployment uses xapi-to 0.1.23. Authenticate the CLI with a key scoped to `workers:read` and `workers:write`, stored in its configuration or environment, never in this repository.

```sh
npm run gauntlet
npx xapi-to@0.1.23 workers plan --env preview
npx xapi-to@0.1.23 workers push --env preview --non-interactive \
  --retention-price-version cf65a-production-retention-20260917-v1
npx xapi-to@0.1.23 workers promote --to production --non-interactive \
  --retention-price-version cf65a-production-retention-20260917-v1
```

The manifest builds with `KANBY_XAPI=1` and compiles only `KANBY_PUBLIC_ORIGIN=https://kanby.dev`. Runtime `PUBLIC_APP_ORIGIN`, if supplied, takes precedence and must pass origin validation. GitHub credentials and session secrets are runtime bindings, written separately per environment through `workers secrets set ... --stdin`. Normalize escaped newlines in the GitHub PEM before sending it. Never print credentials or pass their values in command arguments.

Wrangler `deploy --dry-run` is a local packaging step. Publish the complete resulting artifact through xAPI, preserving its modules and static assets. Do not deploy this managed Worker directly to Cloudflare. Original Cloudflare deployment instructions are retained in `CLOUDFLARE_DEPLOY.md` for independent installations.

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
npx xapi-to@0.1.23 workers domains attach \
  3ef2459b-f47d-4a59-a46f-8dc132346df4 --env production \
  --xdomain-domain-id dom_mtirxgsdc3rf9k2p --subdomain @
```

Verify DNS/TLS, root-relative assets, authenticated metrics/activity and attachment persistence. The OAuth App callback must be `https://kanby.dev/api/auth/github/callback`; the separate GitHub App webhook uses `https://kanby.dev/api/github/webhook`. An OAuth redirect alone does not verify successful sign-in.

Native Wrangler cron triggers are not imported by xAPI. Configure a production schedule for `*/10 * * * *`, method POST, path `/__kanby_recovery`, with JSON `{signature}`. Compute `signature` as `sha256=` plus the hex HMAC-SHA256 of `kanby-recovery-v1` using the environment's `GITHUB_WEBHOOK_SECRET`. Deliver this body to the CLI in memory; do not put it in source control, process arguments or logs. The endpoint verifies the signature and forwards the signed fixed message to the existing recovery handler. Update the schedule signature after rotating the webhook secret. Test an immediate run and inspect run history; a successful manual run does not prove future cron firing.
