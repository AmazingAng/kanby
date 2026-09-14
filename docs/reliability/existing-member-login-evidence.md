# EVIDENCE — Existing project member GitHub login

## Outcome

Kanby now treats an active `project_members` row as sufficient authorization
for a returning GitHub user even when global login, organization, or team rules
are configured. Membership is matched against GitHub's immutable numeric user
ID, so a username change does not lock out the member or grant access to a
different account that later acquires the old username.

Historical accepted invitations and standalone `users` rows do not authorize
login. Pending invitations and the existing global rules retain their previous
behavior.

## Executable specification

- `tests/github-oauth-callback.test.ts` covers an existing member with a renamed
  GitHub login, a removed member with only an accepted invitation, an unrelated
  GitHub account, and first login through a pending invitation.
- Initial RED run: the existing-member scenario expected HTTP 302 but received
  HTTP 403 before the implementation was added.
- Targeted final run: 1 file passed, 7 tests passed.
- The implementation adds one read-only membership lookup and no schema or data
  migration.

## Gauntlet

- Clean detached worktree at source commit `db469e3`.
- Full suite: 28 files passed, 154 tests passed.
- Randomized suite order: 28 files passed, 154 tests passed, seed `9082026`.
- Changed-code coverage suite: 91.6% statements, 87.65% branches, 98.48%
  functions, and 94.86% lines across its configured files. The OAuth route is
  verified by integration and mutation tests but is not included in that
  coverage allowlist.
- Mutation testing: 62/62 killed, including four new authorization mutations:
  removing active-member access, forcing the boundary open, treating a
  historical user as a member, and treating accepted invitations as pending.
- TypeScript, oxlint, oxfmt, CLI contract and package checks: passed.
- Production dependency audit: 0 high-severity production vulnerabilities.
- Secret scan: passed for 245 files and reachable Git history; negative control
  detected.
- Worker production build and recovery schedule checks: passed.
- `npm run gauntlet`: `GAUNTLET PASS: 13/13 layers`.

## Deployment

- Cloudflare Worker version: `27073ff8-6e50-4243-9390-92b9d2665f6f`.
- Existing D1 database `kanby-db` and R2 bucket `kanby-attachments` remained
  bound; no migration or write was performed.
- Live OAuth entry point returned HTTP 302 to GitHub with secure, HTTP-only,
  same-site state and PKCE cookies.
- A read-only production query confirmed that `dxiongya` and `glacier-luo`
  remain active members of the `xapi` project; the query reported zero writes.
- A full callback cannot be replayed on another member's behalf because it
  requires that person's GitHub authorization session. Those members must retry
  login to complete the final end-to-end confirmation.

## Confidence notes

This is a Tier 3 authentication and authorization change. The autonomous repair
did not obtain separate specification approval, and no independent verifier was
used. Confidence comes from the production-state diagnosis, fail-closed route
integration tests, non-vacuous mutation tests, a clean-worktree gauntlet,
successful production deployment, and live read-only checks.
