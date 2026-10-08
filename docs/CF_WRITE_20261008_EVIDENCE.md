# Native Cloudflare writable recovery — 2026-10-08

The user requested “要也能写入”, superseding the October 2 read-only decision.
<https://kanby.0xaa.workers.dev> now accepts writes on a new native D1 cloned
from the restored October 1 baseline. Later xAPI data remains unrecovered.

Specification: [CF_WRITE_20261008_SPEC.md](CF_WRITE_20261008_SPEC.md).
Spec approval: not obtained (autonomous run). Deployment and writable-baseline
authorization are explicit; independent fresh-context verification was not
performed. This report distinguishes executed checks from unverified behavior.

## Deployment and preservation

- Application/dependency source: `f4baaf7` (no application handler changes).
- Account: `4592ac4d37d07944e6abee1c15a6cc00` (0xAA).
- Worker: `kanby`; version: `c17bd9b8-2807-437f-b1f0-bc0860bb6438`.
- Writable D1: `kanby-db-writable-20261008`,
  `d5436e67-4784-416a-9e78-b2029a78a79d`.
- Retained archive: `kanby-db-native-20261002`,
  `5b8406e6-563e-4e79-bf57-f8211adbaba3`, still has all 99 write guards.
- Existing R2: `kanby-attachments-native-20261002`.
- Native origin retained; authentication secrets preserved; no custom route or
  `kanby.dev` DNS change. No cron schedules: periodic GitHub recovery remains
  paused pending reconciliation of the historical baseline.

Before making changes, saved the existing Worker artifact, settings, deployments,
schedules and a fresh guarded D1 export. Restored the clone after removing only
the exact 99 named `_kanby_recovery_*` triggers. A local SQL replay with foreign
keys enabled passed; a changed-title negative control proved the content checker
rejects a same-row-count alteration. Full prepublication remote re-export matched
all schema objects, sequence values and canonical contents: **34 tables, 31,860
rows, 122 tasks**. The baseline contains no attachments.

The normal-mode build uses no recovery label, xAPI dispatcher or migration route.
It was built in a clean Git export without `.env` files, using the final pinned
lockfile and installed toolchain. A temporary build plugin recorded generated
chunk module IDs without changing runtime behavior. The generated configuration
explicitly keeps cron empty, selects the new D1, retains R2 and enables workers.dev.
Wrangler dry-run and the real publication both succeeded. Live settings and the
active deployment confirmed all bindings and the version above.

## Executed verification

- `npm run gauntlet`: **17/17 layers**, **244 tests / 36 files**, **90/90 mutants**;
  includes types, lint, formatting, secret scan, package checks, randomized test
  order, coverage and production build. No threshold or test was weakened.
- Recovery helper coverage: 100% statements (10/10), branches (13/13), functions
  (2/2), lines (8/8); normal and recovery modes remain regression-tested.
- `npm audit --omit=dev --audit-level=high`: **0 findings** after the dependency
  changes described below. This does not mean the full development tree is clean.
- **18 live HTTP checks** with an isolated synthetic project/token: normal pages
  without a recovery banner, unauthenticated write rejection, configured browser
  authentication, Agent task create/update/readback, session start/wait/reply/end,
  persisted end status, closed-session rejection, correct OAuth callback initiation
  and absent migration endpoint. The reply is correctly `agent_reported`; it is
  not evidence of a verified human review.
- **4 actual CLI commands** against the deployed origin: session start, end,
  readback and task list. Credentials were passed in the process environment.
- Synthetic fixture cleanup is scoped to this run's project/user/token/session
  IDs. All owned fixtures are removed and the temporary credential becomes
  unusable. A post-cleanup export checks original contents and schema; monotonic
  metric sequence advances from the smoke test are preserved, never rewound.
  The final export retains 34 tables / 31,860 rows / 122 tasks. All task data and
  schema match the baseline. The strict equality check detected one pre-existing
  user's `updated_at` advancing during live traffic; every other field matches.
  That timestamp's writer was not independently attributed. It was preserved,
  along with metric sequence advances 5 → 7 and 320 → 323, rather than reverted
  to the snapshot. The follow-up comparison permits only these recorded deltas.

## Audit repair and remaining development risk

The first full gauntlet stopped at the unchanged production audit with 13
findings (1 moderate, 11 high, 1 critical). Updated four compatible transitive
packages: MCP SDK 1.30.0 → 1.32.1, Hono 4.13.5 → 4.13.13, proxy-addr 2.0.7 →
2.0.8, and source-map-js 1.2.1 → 1.2.2. Their licenses remain MIT / BSD-3-Clause.
No direct dependency or package version exception was added.

Moved the existing pinned `vinext` and `shadcn` entries to devDependencies because
this deployment uses them for building/generating code, and uploads the resulting
Worker modules rather than installing production node_modules. This classification
does not fix build-tool vulnerabilities. The full development audit still reports
**19 findings: 4 moderate, 13 high, 2 critical**, including unpatched braces and
other tooling advisories. Do not process untrusted repositories or inputs with
these tools. The final build used this trusted checkout.

Recorded **128 emitted chunks and 1,060 unique module inputs**. Packages with
direct remaining advisories (braces, esbuild, sharp, tinypool) are absent from
those inputs. Runtime parts of Vinext are bundled normally; its vulnerable glob
build chain is absent. This is artifact-specific evidence, not a blanket claim
about other Vinext deployments. The braces advisory currently has no patched
release: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## Limits and recovery rules

The planned live browser write/attachment smoke could not authenticate with a
locally signed test cookie: project creation returned 403 before any fixture
was created. The existing deployed session secret was preserved; no production
authentication bypass or secret rotation was introduced to make the test pass.
Browser task writes, verified-human review and R2 upload/download are therefore
**not live-verified in this activation**. Their application tests pass, OAuth
initiation and configuration pass, and the same normal application handles
browser requests, but completed interactive GitHub sign-in remains unverified.
This is an explicit downgrade from acceptance item 4 in the specification.

Operational tooling initially tried an unsupported array-shaped D1 REST query;
it was rejected before inserting fixtures and was replaced with supported
parameterized object requests. The first live smoke used the unavailable signing
key noted above; Agent/CLI checks then used a dedicated short-lived fixture.
Wrangler did not emit the requested esbuild metafile for this already bundled
artifact; module evidence comes from the build's actual chunk metadata instead.

Keep the original guarded archive and the fresh writable exports. Once users
write to the new D1, rolling back to the old Worker version would restore its
old DB binding and hide new data. Roll back code only while retaining the new
binding, or restore a verified fresh backup. Reconcile any later recovered xAPI
records with new native writes; never overwrite the writable baseline wholesale.

Private exports, fixture evidence, module inventories and logs are retained under
ignored, access-restricted `outputs/cf-write-20261008/private/`. No credentials or
customer data are committed. Operational reproduction requires those artifacts
and account access; repository-only checks are `npm ci && npm run gauntlet`.
See [deployment configuration requirements](CLOUDFLARE_DEPLOY.md) before rebuilding.
