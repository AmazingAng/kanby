# SPEC — Existing project member GitHub login

- Tier: 3 — authentication and authorization boundary
- Spec approval: not obtained (autonomous bug-fix run after the user reported the production failure)
- Setup plan:
  - Tools to install: none
  - Git isolation: branch `codex/auth-existing-project-members`; final gauntlet runs in a clean detached worktree
  - Files added by the gauntlet: this spec and `docs/reliability/existing-member-login-evidence.md`; reuse `tools/gauntlet.sh` and `tools/mutants.mjs`
  - New dependencies: none

## Failure model

- An accepted project member is denied because only pending invitations bypass the global allowlist.
- A removed member is accidentally allowed by a historical accepted invitation.
- A stranger is allowed because “any prior user” is mistaken for an active project member.
- A renamed or recycled GitHub username impersonates a member; existing membership must match GitHub's numeric account ID.
- A pending invitation stops working, preventing a new member's first login.
- Empty global access rules change semantics; existing deployments intentionally allow any GitHub account when no rules are configured.
- GitHub email, organization, or team lookup failure becomes fail-open.

## Scenarios

1. Given access rules are configured and GitHub user ID `42` is an active member of any Kanby project, when that account completes OAuth, then the callback creates a session and redirects successfully even when its username is absent from the global allowlist.
2. Given the same user has been removed from all projects and only an accepted invitation remains, when OAuth completes, then the callback returns HTTP 403 and creates no session.
3. Given a stranger has no active membership, pending invitation, or matching allowlist/org/team identity, when OAuth completes, then the callback returns HTTP 403.
4. Given a pending invitation matches the GitHub username or a verified email, when OAuth completes, then the callback succeeds and accepts the invitation as before.
5. Given an active member's stored login differs from the current GitHub login but the numeric GitHub ID matches, when OAuth completes, then access succeeds and the user profile is refreshed.

## Must NOT

- Do not disable or overwrite `ALLOWED_GITHUB_LOGINS`, organization, or team rules.
- Do not allow a record in `users` without an active `project_members` row to bypass access rules.
- Do not treat an accepted invitation as continuing authorization after member removal.
- Do not compare existing membership by mutable GitHub username or email.
- Do not mutate production D1 records, add a migration, or expose OAuth tokens/codes/secrets.
- Preserve OAuth state/PKCE validation, no-follow GitHub requests, safe return targets, and session cookie security.

## Revisions

- Initial autonomous specification based on the verified production member/invitation state.
