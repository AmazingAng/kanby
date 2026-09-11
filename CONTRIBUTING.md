# Contributing to Kanby

Thanks for helping improve Kanby. Small, focused changes with tests are the easiest to review and ship.

## Before starting

- Search existing issues and pull requests before opening a duplicate.
- For a large feature, schema change, authentication change, or public API change, open a proposal issue first.
- Never include real OAuth credentials, GitHub App keys, webhook secrets, session secrets, repository data, or Agent Tokens in code, fixtures, screenshots, or logs.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development workflow

1. Fork the repository and create a focused branch.
2. Install Node.js 22.13 or newer and run `npm ci`.
3. Copy `.env.example` to `.dev.vars` and use development-only credentials when the change requires authentication.
4. Add or update tests before changing behavior.
5. Keep D1 migrations append-only. Never edit a migration that may already have run in another environment.
6. Run `npm run gauntlet` before opening the pull request.

The gauntlet must finish with every declared layer complete. Do not bypass tests, lower thresholds, add skips, or use `|| true` to make a gate appear green.

## Pull requests

A pull request should explain the problem, the chosen behavior, security or migration impact, and the commands used to verify it. Include screenshots or a short recording for visible UI changes. Keep generated output, local Worker state, credentials, and personal data out of commits.

By contributing, you agree that your contribution is licensed under the repository’s AGPL-3.0-only license.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md) so maintainers can coordinate a fix before disclosure.
