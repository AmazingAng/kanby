# EVIDENCE — Member-owned Agent Tokens

## Outcome

Kanby now lets every current project member create Agent Tokens for their own
coding agents. The server derives the visible label as
`<authenticated-github-login>_<token-name>`. Members can list and revoke only
their own tokens; project owners retain project-wide administration.

Token creation is capped atomically at 10 active, unexpired tokens per member
and project. Token plaintext is returned only by the successful create response,
the database retains the SHA-256 digest, and removing the issuing member
immediately invalidates their tokens.

## Executable specification

- `tests/agent-token-self-service.test.ts` covers member creation, spoof
  resistance, list isolation, revocation authorization, non-member rejection,
  membership removal, atomic issuance limits, and hostile names.
- `tests/agent-token-policy.test.ts` runs 1,500 generated cases across name
  normalization, raw control-character rejection, and server-derived labels.
- Initial RED run: 5 of 7 self-service tests failed before implementation. The
  existing non-member and removed-member checks already passed.
- Property-test RED run found the minimal counterexample `"!\t"`: checking
  controls after trimming accepted a trailing tab. The implementation now
  checks the raw input before normalization.
- Targeted final run: 2 files passed, 10 tests passed.

## Gauntlet

- Full suite: 18 files passed, 102 tests passed.
- Randomized suite order: 18 files passed, 102 tests passed, seed `9082026`.
- Changed-code coverage: 95.32% statements, 89.06% branches, 100% functions,
  99.46% lines.
- Mutation testing: 35/35 killed, including active-token limit, member list
  scope, member revoke scope, raw control handling, and label derivation.
- TypeScript, oxlint, oxfmt, CLI unauthenticated exit contract: passed.
- Production dependency audit: 0 vulnerabilities.
- Secret scan: passed for 205 files; negative control detected.
- Worker production build: passed.
- `npm run gauntlet`: `GAUNTLET PASS: 11/11 layers`.

## Deployment

- No dependency or database migration was required.
- Cloudflare Worker version: `03075cf5-a106-4ab7-8620-06ec0552b8dc`.
- Live checks: `/settings?release=03075cf5` returned HTTP 200; an unauthenticated
  `/api/agent-tokens` request returned HTTP 403.
- Pre-evidence source-state digest:
  `dbfcddec0d154edd8c5d401b91d606d5bbed66f91b97e457584aab30b33c0416`
  across 207 tracked source inputs.

## Confidence notes

This was a Tier 3 authentication and authorization change. The autonomous run
did not obtain separate spec approval, so that confidence claim is unavailable.
No independent verifier was used. The evidence instead includes route-level D1
integration tests, concurrent creation attempts, property testing, mutation
testing, static gates, a production build, deployment, and live HTTP smoke
checks. Authenticated visual QA still requires a signed-in member session.
