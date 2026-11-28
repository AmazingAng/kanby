# Mini board and responsive detail contract

KANBY-145. Spec approval: not obtained (autonomous run, per standing delivery
instructions). Tier 3 for member API scope and asynchronous client behavior.
No new dependencies, migrations, credentials or permission grants.

1. Account controls show the full nickname in a bounded chip; checklist rows
   span their container on native WeChat. Explicit button size overrides must
   beat native button:not([size=mini]) styling. Keep adequate touch targets.
2. An authenticated project has a visible turn queue / board switch. The board
   displays active tasks grouped into ideas, building and shipped with counts;
   the user can browse all three columns horizontally and open any card.
   Archive and foreign-project tasks remain excluded. Board browsing is read-only.
3. GET /api/mini/tasks?projectId=P&view=board returns {tasks: TaskRecord[]} under
   existing mini-session membership checks. Default queue and detail responses
   retain compatibility. IDs and KANBY-N references resolve one active task in
   the authorized project without fetching all project task relationships.
4. Selecting a card immediately displays its known title and a loading skeleton.
   Only a completed fresh detail request enables comments/checklist/acceptance.
   Returning to the list preserves board/queue selection. A warm per-page cache
   may show previous detail while revalidating but never authorizes stale writes.
   Caches clear on project/account changes, 401/403/404 and logout. Late responses
   cannot paint a different selected task, project or account. No persistent
   cache of task contents. An error shows retry and allows returning to list.
5. Loading indicators reflect actual requests rather than claiming sync before
   data arrives. Long notes/activity remain expandable; null bodies stay hidden.

Failure model: cross-project leakage (real DB membership/foreign task tests),
archived task exposure (DB regressions), task lookup cost growing with unrelated
rows (query-scope assertions), stale detail on navigation (deferred Promise client
tests), cache surviving revocation (401/403 clearing), stale writes (busy gates,
revision/conflict tests). Phone latency depends on network; no unmeasured latency
SLA is claimed. Benchmark current production reads only where existing legitimate
session access is available; never mint a user session just for measurement.

Workflow: isolated feat/mini-board worktree, regression RED before implementation,
existing gauntlet plus focused native sizing/controller/API regressions. Use
existing pinned miniprogram-ci in temporary tooling for 0.1.3 upload/preview.
Deploy server via existing xAPI Worker preview then production and verify public
unauthorized API behavior. No database import/reset. Fetch, merge and push main.
Record evidence in docs/WEIXIN_MINI_BOARD_EVIDENCE.md. Native iPhone rendering
acceptance remains explicit; HTML previews cannot establish WeChat cascade.
Independent old-coder verification protocol not performed; code review may be
used without claiming that protocol.
