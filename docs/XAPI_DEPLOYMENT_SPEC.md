# xAPI deployment acceptance

Scope: move the existing Kanby service and data to the user's xAPI Worker and kanby.dev, preserving task IDs, membership, Agent tokens, GitHub integrations and metric history. Existing production remains authoritative until a verified cutover. No production data goes to preview.

Spec approval: not obtained (autonomous run). The user authorized deployment, domain binding, existing configuration reuse, and retention-v3. Implementation details are verified below, not represented as separately approved.

## Executable checks

1. Authentication may use an explicitly compiled public canonical origin when a runtime origin binding is absent. Existing runtime configuration wins, including invalid values failing closed. No origin configured still fails closed. Secrets are runtime bindings only.
2. The optional migration build serves /demo for health and denies normal traffic. Its single migration endpoint requires a strong runtime token and a finite future expiry; missing, wrong, expired credentials and unsupported methods fail without DB access.
3. SQL import is bounded, transactional per batch, and journaled in the same batch. Retrying identical batch IDs returns success without another import; reusing an ID with different content fails. Failed batches never acquire a completion record. A read-only query operation supports verification. Normal builds contain no migration endpoint.
4. xAPI recovery requests require a valid HMAC for the fixed recovery message. Invalid or malformed requests cannot run recovery. Existing native Cloudflare scheduled execution remains unchanged.
5. Tests run before implementation; existing suites, types, lint, formatting, secret scan, build and gauntlet pass. Actual preview reads/writes persist; source/target table counts and contents match at production cutover. Application metrics/activity return authenticated JSON, not 404. Domain DNS/TLS and assets are verified.

## Setup and evidence

Use branch codex/xapi-worker-deploy in the existing isolated worktree. No new dependencies. Files: tools/xapi-migration.mjs, tools/xapi-scheduled-recovery.mjs, tools/add-worker-schedule.mjs, vite.config.ts, lib/auth.ts, tests/xapi-deployment.test.ts, xapi.worker.json, docs/XAPI_DEPLOYMENT_EVIDENCE.md and deployment docs. CLI default origin follows the final verified canonical domain. Temporary export files and migration credentials remain outside Git with mode 600. Preserve the original database and deployment rollback identity. Migration access is removed before domain cutover.
