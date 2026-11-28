# KANBY-144: preserve notification task links through sign-in

Spec approval: not obtained (autonomous run). User requested fixing the observed
mobile notification link; routine commit, merge, push and deployment authorized.
Apply old-coder's scoped auth-boundary workflow. Use existing clean isolated
worktree on fix/task-login-deeplink from 92f8b97; retain locked dependencies,
no new dependencies or database changes.

Observed: authenticated Chrome opens KANBY-144 correctly. The logged-out board
links to GitHub with returnTo=/xapi/board, dropping ?task=KANBY-144. Preserve the
pending task reference in the login return path. Keep the existing board-opening
logic and project permissions.

Acceptance and failure model:

- Signed-out notification links carry both project and exact task reference
  through OAuth initiation, cookies and successful callback Location.
- No task parameter preserves existing board/root login behavior.
- Legacy ID prefixes work; arbitrary references remain encoded query data and
  cannot change origin or inject other parameters/fragments (property tests).
- Authenticated desktop and mobile viewport direct links open the requested
  card; closing it does not reopen it on the next normal data refresh.
- Invalid/inaccessible references never open an unrelated card. Preserve OAuth
  CSRF/PKCE and access checks via existing security suite.

Files: lib/task-deep-link.ts, components/kanban-app.tsx,
tests/task-deep-link.test.ts, tools/mutants.mjs, tools/gauntlet.sh, this spec,
docs/TASK_LINK_FIX_EVIDENCE.md. Add a 100% helper coverage gate; three transport
selection/encoding mutants; run full gauntlet. Preview deploy, verify actual
signed-out login href, promote exact artifact, production mobile/desktop check.
No user logout or synthetic impersonation of the real account. Preserve task
status building for the user's final acceptance. Record limitations honestly.
