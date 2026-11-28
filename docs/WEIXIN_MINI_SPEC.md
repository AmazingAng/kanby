# Kanby personal WeChat mini program

Contract: KANBY-145. User authorized implementation and clarified that the account
is not registered yet: finish code/local verification first. No production
migration, deployment, provider registration, or publishing in this deliverable.

Tier 3 (identity and member writes). Spec approval: not obtained (autonomous run).
Isolation: branch feat/weixin-mini in /private/tmp/kanby-mini-20261128, based on
origin/main 0fcd118. No new dependencies. Install lockfile dependencies with npm ci.
Main checkout's .env and generated outputs are not copied to the worktree.

## Behaviors

1. With no WEIXIN_MINI_APP_ID/WEIXIN_MINI_APP_SECRET, mini login is 503 and makes
   no provider call. Credentials only exist on the server. Use wx.login and
   api.weixin.qq.com/sns/jscode2session, bounded timeout, manual redirects,
   validate response, generic errors without codes/secrets in logs or responses.
2. Unlinked verified identity receives a random one-time pairing code (5 minutes).
   Only a fresh existing GitHub browser session, same origin, explicit POST can
   attach that identity to the signed-in user. Codes are hashed at rest; expired,
   consumed, conflicting bindings fail. No user creation, membership grants,
   nickname matching, iLink-ID matching or GitHub admin claims from mini login.
3. Login after pairing issues opaque 7-day mini-only bearer session, hashed at
   rest, scoped to app and binding. Cookie/Agent tokens cannot authenticate mini
   API; mini tokens cannot authenticate browser/Agent routes. Logout revokes the
   token; browser unlink invalidates every session. Unique constraints and atomic
   INSERT SELECT / conditional writes prevent duplicate or reassigned identities.
4. Login bounded per source IP before provider exchange, per identity for
   sessions/pair codes; expired records cleaned. Invalid JSON, oversized bodies,
   unknown actions and unsupported media fail closed. No credential caches.
5. GET mini API returns member's projects, per-project turn queue, or a specific
   nonarchived task + paginated activity. Every request checks live membership.
   Never return data from a foreign project. Existing queue semantics retained.
6. Comments use existing user activity attribution/mentions. Checklist toggles use
   existing revision checks. Explicit accept changes a building card to shipped
   only when all criteria are checked and expected revision matches; keep content,
   owners and existing activity/metrics semantics. No auto acceptance on login.
7. Native mini pages (no web-view): login/pairing, project picker, queue, detail,
   description, read-only attachment/GitHub URL copying, activity load-more,
   comment, checklist, confirm acceptance, refresh, error and expired-session UI.
   Deep-link projectId/taskId survives login. Tokens never in URLs or clipboard.
   Browser /mini page supports sign-in, paste pairing code, confirmation/unlink.
8. Unconfigured source can be imported using a local AppID, documented separately
   from real WeChat login. Registration/classification/domain/filing/review and
   notification-to-mini deep links are not claimed verified. No fabricated QR.

## Failure model and verification

- Binding theft/replay/races: fresh browser auth + explicit user confirmation,
  same-origin checks, hashed high-entropy code, SQL uniqueness/atomic consumption;
  replay and conflict/concurrency integration tests with real SQLite D1 adapter.
- Credential leaks/redirect exfiltration: fixed provider origin/manual redirects,
  secret-free payload, diff scan, stubbed boundary adversarial responses.
- Stolen/revoked/foreign tokens: DB-backed expiry/revocation/app isolation tests.
- Task overwrite/tenant leakage: membership + project/task isolation + existing
  compare-and-swap writes; stale/concurrent updates and permission removal tests.
- Migration rollback: additive 0020 tables only; apply on populated fixture,
  remove new tables in local rehearsal and verify original task survives.
- Client stale UI/duplicate submits: busy state, reload after writes, retain failed
  comment, explicit confirmation and 401 re-login; execute page controllers in VM
  with wx boundary doubles. Real WeChat rendering cannot be validated without ID.

## Files and checks

Add drizzle/0020_weixin_mini.sql, matching db/schema.ts definitions;
lib/weixin-mini*.ts; app/api/mini/{auth,account,tasks}/route.ts;
app/mini/page.tsx; components/mini-account.tsx; miniprogram/**;
tests/weixin-mini*.test.ts; docs/WEIXIN_MINI_{SPEC,EVIDENCE}.md and
miniprogram/README.md. Extend tools/gauntlet.sh and tools/mutants.mjs, package.json
format targets. No changes to existing browser auth or Agent token scopes.

RED behavior assertions before implementation. Full existing gauntlet, focused
mini coverage gate, meaningful mutation defects, property and shuffled tests,
TypeScript/lint/format/build/secret scan. Changed-line coverage and client VM
coverage limitations reported numerically, no unexecuted real-device claims.
Independent fresh-context verification: not performed, declared lower assurance.
Commit spec, implementation after checks, fetch then merge/push main per AGENTS.

## Setup clarification

Native WeChat JavaScript uses CommonJS `require`; .oxlintrc.json gets a narrowly
scoped no-require-imports exception for miniprogram/**/*.js only. Other lint rules
remain active. components/weixin-settings.tsx links to /mini; .gitignore excludes
local developer-tool configuration. Migration journal records 0020 as well.

The optional AppID is added to vite.config.ts's public Worker runtime-vars
allowlist; AppSecret remains a secret binding. .env.example documents both names.
Session retention is five latest logins with rowid as the tie-breaker when login
creation times share a millisecond. Authentication tests freeze time to cover it.
