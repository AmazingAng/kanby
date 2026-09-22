# xAPI deployment evidence

Date: 2026-09-22. Base: `b0b57b869db5ee78f1b00629d107bc20714ae54d`. Implementation branch: `codex/xapi-worker-deploy`.

Spec approval: not obtained (autonomous run). The user authorized deployment, existing configuration reuse, domain binding, database migration and retention-v3; the implementation spec did not receive separate human review. Evidence supports the listed checks, not an unconditional correctness claim.

## Local checks

- RED: the original eight new behavior tests failed against stubs before implementation.
- Full suite: 212 tests in 32 files passed, including randomized ordering.
- New helper coverage: 100% statements, lines and functions; 98.38% branches. Thresholds are enforced by `npm run test:xapi`, now included in the 15-layer gauntlet.
- `npm run gauntlet`: 15/15 passed, including type checking, lint/format, metric coverage, existing mutation suite, production dependency audit, secret scan with negative control, CLI contracts/package check, build and native scheduled handler verification.
- Four additional manual mutants were executed and killed: accept wrong token, accept expired token, re-import completed batch, accept invalid HMAC. The expired-token mutant initially survived because that test also supplied an invalid token; the test now isolates expiry with valid credentials and kills the mutant. Helpers were restored after every mutation.
- Final xAPI artifact wrapper includes signed recovery but neither the migration import nor `/__kanby_migration`.
- The first remote CI run caught a README heading change made after the local gauntlet. The established `Cloudflare deployment` heading and anchor were restored without weakening the release-contract test; the xAPI guide remains linked from that section.
- No dependencies were added. The isolated checkout omits the root ignored `.env`; build receives only the public origin. Runtime credentials were delivered separately through CLI stdin. Generated exports and temporary credentials are outside Git in a private directory.

## Actual preview acceptance

- Migration deployment: `7122d218-a796-4689-903a-fe460835fe65`; artifact `d140377d-bf8a-40f9-9b21-d7666153f81e`.
- Authenticated real D1 operations persisted across requests. An intentionally failing two-statement batch rolled back its first write and did not acquire a completion marker. An identical retry returned replay success; a conflicting batch ID returned 409. Invalid credentials returned 403 and ordinary routes returned 503 in maintenance mode.
- All 16 schema migration files applied to the preview database. Only synthetic project/member/token data was used.
- Normal preview deployment: `34a6233f-0f12-4da1-b71e-f1570d5a8df5`; artifact `8c74910f-55b3-478e-86f7-a516eec8f204`; SHA-256 `67bd8ff5a0cf8af867f188e4f0472b6a84faabfa014b4a1ec575ff2eed412de9`.
- Authenticated `/api/v1/metrics`, `/api/v1/activity` and `/api/v1/projects` returned 200 JSON. A task was created through the actual Agent API. Invalid recovery signatures returned 403; the migration route returned 404.
- A synthetic attachment was uploaded to R2, fetched with matching contents and SHA-256, deleted, then fetched again with 404. Acceptance SHA-256: `06e9d900eff0355d936875e5b4844b300379489c2c80c7455f8e144ae180d3a7`.
- OAuth initiation returned the canonical callback `https://kanby.dev/api/auth/github/callback`. This checks redirect construction, not completed interactive OAuth sign-in.

## Production migration

The original deployment was `68485e0f-a478-46d7-b729-44293c1fcb00`, version `3fa6f900-d831-45ee-ab35-f4c0296960ca`. Its code, settings and full data were backed up privately. The old Worker entered maintenance and scheduled execution became a no-op. Temporary source write guards prevent in-flight requests from changing the final snapshot; those guards are excluded from target imports. Original storage is retained.

The final snapshot contains 29 business tables and 22,509 rows, including 85 tasks, eight Agent token records, memberships and GitHub/metric history. It has zero attachment records. Source data has not been copied to preview. Production migration deployment `23239c20-b873-4bd3-bc80-d26f357cfd65` uses the exact preview migration artifact.

All 29 business tables and all 22,509 rows matched the final source snapshot by record count and canonical full-row SHA-256. The three SQLite sequence counters also matched (migration 16, member events 4, task events 111). The destination has no source maintenance guards.

Normal production deployment `18d19713-c7cf-4ae8-83a5-d4ef67744711` activated the exact normal preview artifact. Before domain attachment, `/api/v1/metrics` returned 401 without authentication and the removed import route returned 404. Runtime secrets were checked absent from the artifact. Production is **not accepted for cutover** because the later domain failure blocked runtime admission.

### Cutover blocked; original service restored

- `kanby.dev` still has two pre-existing apex A records. Cloudflare rejected the xAPI custom-domain creation with HTTP 409/code 100117. Those DNS records were preserved; the combined command cleaned up its temporary verification TXT.
- Domain record `34c829c2-4dde-45ca-9a60-9f7e71f26ccf` reports `cloudflare_domain_provision_failed`. Audit `4374716a-a4d0-4971-a254-237502fd9f2d` recorded the provider PUT as UNKNOWN, writer token `6b4e5791-2a14-4cbb-85e7-b622c02dcac8`. This is an operation correlation ID, not an authentication secret.
- Production requests subsequently returned HTTP 402, `worker_lifecycle_in_progress`. Both domain retry and temporary-secret deletion returned HTTP 409, `worker_control_protocol_required`. The control-operation history contains no recoverable operations; legacy entries explicitly report `automaticRecovery: false`. This requires platform recovery of the failed domain operation before another cutover attempt.
- Recovery schedule `6976939e-5a83-482b-907d-f2151b68e22d` was created. Immediate run `59c8f296-7029-48fd-be21-1764b67577bb` failed with runtime HTTP 402 before application execution. The schedule was paused to avoid repeated failures.
- Temporary migration bindings were deleted from preview. Production deletion is blocked by the same control error. The normal artifact has no migration route, even while those unused bindings remain; their recorded expiry is finite.
- Source write guards were removed and the original Worker version was restored. Original storage is authoritative again; the xAPI copy is a verified snapshot, not a continuously synchronized database. Repeat a final quiesced snapshot transfer and comparison before any later cutover. Never redirect legacy clients to the currently blocked target.
- Neither legacy routing nor the GitHub webhook URL was switched. Interactive OAuth completion remains unverified and the OAuth App callback requires owner confirmation.

Private rollback backups are retained under the root checkout's ignored `outputs/xapi-deployment-20260922/private/` directory. They include source SQL, code, settings, deployment and schedule identity, verification manifests and DNS inventory. No production data or credentials are committed.

## Platform observations

R2 readiness required same-resource retries in both environments. The CLI 0.1.23 production promotion path omits the retention price version when creating the deployment; recovery uses the supported deployment primitive with the same artifact and explicit approved version. No xAPI-managed deployment was replaced by a direct Cloudflare upload. Source Worker changes only quiesce the old service and preserve legacy client routing.

Application behavior, deployment ACTIVE, retention reserves, metering freshness and invoice reconciliation are separate outcomes. Billing initially reported `INDETERMINATE`; this report does not claim finalized costs or provider invoice reconciliation.
