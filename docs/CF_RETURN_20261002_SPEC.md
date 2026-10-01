# Return the canonical service to native Cloudflare Workers

Tier 3: production data migration and routing. Spec approval: not obtained
(autonomous execution under the user's explicit deployment/migration request).

## Setup and scope

Use branch `codex/cf-native-return-20261002`, the existing pinned Wrangler and
application dependencies, and Python's standard library. No new dependencies.
Keep exports, credentials and generated builds under the ignored,
access-restricted `outputs/cf-return-20261002/` directory. Record final evidence
in `docs/CF_RETURN_20261002_EVIDENCE.md` and update hosting documentation only
after the corresponding operation is verified. Commit, fetch, merge and push
according to the repository collaboration instructions.

The xAPI Worker control API is unavailable and runtime dispatch returns 503.
The native 0xAA Cloudflare account and its retained legacy database are
accessible. Source-account access and current source storage must be resolved
before treating any snapshot as current.

## Acceptance and failure model

1. Identify the current source D1/R2, target account, native Worker and domain
   ownership. Back up existing deployments, bindings, schedules and routing.
   Do not mistake the legacy database or October 1 pre-release backup for a
   current authoritative export.
2. Quiesce or verify blocking of all source writes, including scheduled work
   and alternate hostnames. Export the final source schema and complete data;
   preserve task/member/token/history/session identifiers and timestamps.
3. Prefer a new target database so both previous stores remain recoverable.
   Rehearse restoration locally with foreign-key checks and content comparison.
   Restore data without firing application history triggers; recreate indexes,
   views and triggers afterward. Preserve SQLite sequence values and migration
   records. Do not copy legacy maintenance write guards into the active target.
4. Compare every application table by row count and canonical full-row content.
   Verify attachment inventory and copy/checksum every referenced object where
   necessary. A failed or partial import must not receive production traffic.
   Demonstrate that the comparison rejects a deliberately changed row.
5. Build current application code for native Cloudflare, bind the verified
   target D1/R2 and runtime secrets, and verify the candidate service before
   switching `kanby.dev`. Preserve canonical OAuth URLs and existing APIs.
   Do not create a redirect/proxy loop through the old bridge.
6. Transfer only the required domain binding/DNS records. Enable one native
   recovery schedule and keep xAPI execution disabled, preventing two writable
   production services. Do not delete source resources as part of cutover.
7. Verify pages/static assets, Agent API authentication, session/report routes,
   OAuth initiation, rejection of unsigned webhooks, and absence of maintenance
   endpoints. Distinguish live verification from unperformed interactive login.
8. Run applicable repository checks and native build validation. Publish exact
   source/version/database identities, data verification, rollback boundaries
   and any remaining limitation. Unavailable current-source access is a real
   blocker to claiming a complete migration, not permission to discard newer
   records by restoring an old backup.

## Operational limits

Existing application test/mutation layers cover unchanged application logic.
Migration-specific evidence comes from restoration rehearsal, negative controls,
full-data comparison and live boundary checks. Independent fresh-context
verification has not been performed. Old code rollback does not reconcile new
production writes back into a previous database.

## Authorized temporary recovery preview

The user subsequently chose: use the October 1 backup for a read-only recovery
preview at `https://kanby.0xaa.workers.dev`, then enable writes only after the
latest source data is available. This explicitly replaces the immediate
canonical-domain cutover with an interim, clearly labelled snapshot service.

Use a new native D1/R2 pair and retain both original databases. Restore exactly
the selected backup, apply the additive session schema without inventing missing
events, and install database write guards. Add a build-time recovery label,
visible banner, HTTP write/side-effect rejection and disabled cron. Existing
member OAuth must not register users or accept invitations; Agent authentication
must not update last-used timestamps. Unknown/new members cannot join through
this preview. Test these behaviors with SQLite integration, property tests and
explicit negative controls before publication. Verify authenticated reads and
blocked writes against the deployed service, then compare all restored business
data again. Latest-data migration and canonical routing remain deferred.

Expected implementation paths: `lib/recovery.ts`, `tools/recovery-preview.mjs`,
`tools/add-worker-schedule.mjs`, `vite.config.ts`, `app/layout.tsx`,
`lib/agent.ts`, the GitHub OAuth callback, and `tests/recovery-preview.test.ts`.
No new package dependency is required. Full gauntlet and targeted recovery
coverage/mutation checks apply to these changes.
