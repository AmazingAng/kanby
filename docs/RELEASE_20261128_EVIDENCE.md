# Turn collaboration release evidence — 2026-11-28

Deployed source `df62cc4b838b4cefe4c0ee44cd613e21055bd197` to
<https://kanby.dev>. The reviewed fix branch was fast-forwarded into main and
pushed to origin before production migration. This includes turn collaboration,
comments/mentions, notifications, hosted WeChat configuration and the three
review fixes. No application implementation changed during release.

Contract: [RELEASE_20261128_SPEC.md](RELEASE_20261128_SPEC.md).
Spec approval: not obtained (autonomous run). User explicitly authorized merge
and redeployment. Independent fresh-context verification: not performed.

## Build and validation

Built in `/private/tmp/kanby-deploy-20261128` from the exact commit, without the
main checkout's ignored environment files, using `npm ci` and Node 22.22.1.
`KANBY_XAPI=1 KANBY_PUBLIC_ORIGIN=https://kanby.dev npm run gauntlet` passed all
**17 layers**, including **280 tests / 41 files**, types, lint, format, coverage
gates, **96/96 killed mutants**, production dependency audit, secret scan,
CLI package/exit checks, shuffled tests, Worker build and schedule check.
No new dependencies or weaker checks were introduced. Full development-only
advisories are not claimed resolved by the production audit.

- Worker: `3ef2459b-f47d-4a59-a46f-8dc132346df4`.
- Normal artifact: `11395a08-59b8-4208-b12a-8dc4891f8573`.
- SHA-256: `cc3343982d457e962c546788ab97536221ba74b43182eaa47a6bf3032bb25ae6`.
- Preview deployment: `355f4c22-f94d-490e-915f-7f97660a28ab`.
- Production deployment: `89a05839-707c-41e5-97ce-378a207b5d17`.
- Temporary maintenance artifact: `e37d19c6-823c-4189-a98b-15860281dcf9`.
- Previous production artifact retained for code rollback:
  `a29c22ac-c12a-43aa-8ddd-4ac628ac27c3`.

## Migration and data preservation

Provisioned distinct `WEIXIN_CREDENTIAL_KEY` secrets in preview and production
where absent; no existing credential was rotated. Migration tokens were random,
short-lived and sent only to each environment's protected maintenance endpoint.
Production recovery was paused before maintenance. Ordinary writes were denied
while snapshots and migration comparisons ran.

For each environment, exported all application tables and schema into private
backups, loaded a local SQLite copy, and rehearsed migrations 0017–0019 with the
existing schema/triggers. Foreign-key checks passed. Applied the same batches to
remote D1 and verified identical retries return replay success. Compared every
business table's complete canonical row contents with local expected results,
including all backfilled task turn fields. A deliberately altered task set made
the comparison fail, verifying the comparator's negative control. Migration
journals, import markers and SQLite sequences were excluded from content equality.

- Preview: 35 tables / 52 rows before; 41 tables / 58 rows after; 1 existing task
  preserved. Counts precede isolated smoke fixtures.
- Production: 34 tables / 52,406 rows before; 40 tables / 52,412 rows after;
  **165 tasks and 1 attachment record preserved**. Task counts include archives.
- Business contents matched the local rehearsal in both environments.
- Production D1 resource `f498c964-58ed-4f55-bfe7-b85942b35e62` and R2 resource
  `df0ebbb6-004a-4ded-badd-852d8ebee479` remain ACTIVE with unchanged IDs.
  Existing attachment objects were not migrated or overwritten; historic object
  bytes were not separately checksummed during this schema-only release.

## Live checks and cleanup

Preview and production each passed **15 HTTP checks** for pages, five referenced
assets, OAuth initiation, unauthorized API rejection (including next/attachments/
WeChat), and absence of the migration route. Both migration POST endpoints also
returned 404 after normal activation. Old `kanby.0xaa.workers.dev` still returns 404.

An isolated preview principal/project passed **49 additional HTTP checks** and an
actual CLI `next` command: create a task, hand off to the agent, post 35 browser
comments, read unread pages of 20/15/0 without duplication/loss, check the queue,
hand off to the owner, inspect browser turn queue and notification settings, and
verify hosted WeChat reports configured. Browser calls used a short-lived signed
session for the synthetic principal, not an interactive GitHub login. No real
chat channel was bound or messaged. The test task was archived then permanently
deleted; the fixture token was revoked and rejection verified. Its isolated
preview project/user and audit history remain; no customer data was copied there.

The existing production Agent Key read the xAPI project, **133 active tasks**,
the attachment-list API, and the new queue (2 turns / 0 mentions) successfully.
No production collaboration fixture or notification was created.

Removed both migration secrets from both environments and deleted local temporary
migration/fixture token files. Exactly one production recovery schedule is enabled:
`29c4626a-1f34-8eb3-a6c2-231c81936ce0`. Preview and legacy schedules are paused.
Immediate run `a66a7376-1d5e-4870-a206-af3a889e4b12` returned **SUCCEEDED**;
this verifies that run, not future cron execution.

## Limits and reproducibility

Interactive browser UI acceptance, GitHub consent, real WeChat QR binding,
message delivery/fallback and delayed context-token expiry were not exercised.
WeChat is server-configured; each user must bind their own account before delivery
can be accepted. npm publication and external skill installation were not part of
this deployment. No claim is made that CLI 0.7.0 was published to the registry.

Repository checks reproduce with `npm ci && npm run gauntlet`. Remote migration
steps are documented in [XAPI_RELEASE_TURN_WEIXIN.md](XAPI_RELEASE_TURN_WEIXIN.md).
Exact snapshots, rehearsal databases, private operational scripts, comparisons
and receipts are retained in ignored `outputs/release-20261128/private/`; accessing
or repeating those operations requires scoped credentials. No customer rows or
credentials are committed. Code rollback must retain the additive schema and
new writes, not restore the pre-release data snapshot over live data.
