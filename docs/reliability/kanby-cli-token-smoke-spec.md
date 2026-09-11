# SPEC — Kanby CLI production token smoke test

- Tier: 3 (authentication and public API boundary; diagnostic-only)
- Spec approval: not obtained (autonomous run requested by the user)
- Setup plan:
  - Tools to install: none
  - Git isolation: none; this run changes no application source and must exercise the CLI from the user's exact working tree
  - Files added by the gauntlet: this spec and `docs/reliability/kanby-cli-token-smoke-evidence.md`
  - New dependencies: none

## Scenarios

1. Given the supplied Agent Token through `KANBY_TOKEN`, when `kanby auth status --json` targets the production Kanby URL, then the CLI exits 0 and returns an authenticated project without returning the token.
2. Given the same token, when `kanby project list --json` runs, then the CLI exits 0 and returns at least one project.
3. Given the same token, when `kanby task list --json` runs, then the CLI exits 0 and returns a JSON task array.
4. Given a deliberately invalid token, when `kanby auth status --json` runs, then the CLI rejects it with exit code 2 and HTTP status 401.

## Must NOT

- Do not persist the supplied token to the CLI config.
- Do not create, update, claim, complete, archive, or delete project data.
- Do not write the supplied token into source files, test artifacts, command output, or the evidence report.

## Revisions

- Initial diagnostic specification; no application implementation is in scope.
