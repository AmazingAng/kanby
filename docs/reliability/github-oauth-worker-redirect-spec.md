# SPEC — Restore GitHub OAuth on Cloudflare Workers

- Date: 2026-09-14
- Tier: 3 (production authentication)
- Spec approval: not obtained (autonomous repair requested by the user); confidence is downgraded until reviewed.
- Setup plan:
  - Tools to install: none.
  - Git: isolate work on `codex/fix-worker-oauth-redirect`; commit the spec, implementation, and evidence before fast-forwarding `main`.
  - Existing gauntlet reused: `tools/gauntlet.sh` and `tools/mutants.mjs`.
  - Files added: `tests/github-oauth-callback.test.ts`, `docs/reliability/github-oauth-worker-redirect-spec.md`, and `docs/reliability/github-oauth-worker-redirect-evidence.md`.
  - Files updated: `app/api/auth/github/callback/route.ts`, `lib/github.ts`, `tests/github-security.test.ts`, and `tools/mutants.mjs`.
  - New dependencies: none.

## Failure model

1. Cloudflare Workers rejects the unsupported Fetch `redirect: "error"` value before making the GitHub request, converting every otherwise valid OAuth callback into HTTP 500.
2. Replacing it with the default `follow` mode could forward OAuth or GitHub App credentials to a redirect target.
3. A 3xx response in `manual` mode could be mistaken for success and allow a partial or invalid login.
4. A deployment could accidentally replace the production D1/R2 bindings, run migrations, rotate secrets, or change persisted data.
5. Diagnostics could leak OAuth codes, state, verifier cookies, access tokens, or GitHub App credentials.

## Scenarios

### Scenario: OAuth token exchange uses the Worker-compatible no-follow mode

Given a callback with matching OAuth state and verifier cookies, when Kanby exchanges an invalid authorization code, then the outbound request uses `redirect: "manual"`, the GitHub error becomes HTTP 400, and the callback does not throw HTTP 500.

### Scenario: OAuth redirects remain rejected

Given GitHub responds to the token exchange with any 3xx response, when Kanby handles the callback, then it returns HTTP 400, does not follow the redirect, and does not request the GitHub profile.

### Scenario: GitHub App API requests remain origin-bound

Given a GitHub App API request with an installation token, when Kanby builds the request, then its URL remains under `https://api.github.com`, its redirect mode is `manual`, and absolute, protocol-relative, or backslash paths are rejected.

### Scenario: Production OAuth boundary no longer crashes

Given the repaired Worker is deployed with the existing production bindings and secrets, when a callback reaches the token exchange using an invalid diagnostic code and matching ephemeral cookies, then production returns HTTP 400 instead of 500 and Worker logs contain no uncaught redirect-mode exception.

### Scenario: Production state is preserved

Given recorded pre-deployment D1 row counts and the active D1/R2 binding identities, when the new Worker version receives 100% traffic, then post-deployment counts and binding identities are unchanged and no migration or data-writing smoke test has run.

## Must NOT

- Do not use Fetch's default `follow` behavior for any authenticated GitHub request.
- Do not weaken OAuth state, PKCE verifier, origin, session-secret, or allow-list checks.
- Do not change the CLI's Node.js `redirect: "error"` behavior; Node supports it and it remains the stronger compatible option there.
- Do not log or persist authorization codes, OAuth state/verifier values, access tokens, cookies, private keys, or secret values.
- Do not rotate production secrets, change GitHub OAuth/App configuration, run D1 migrations, modify D1 rows, or write/delete R2 objects.
- If the new deployment fails the HTTP, binding, log, or data checks, restore traffic to Worker version `40f52bea-262c-4ca0-b263-6a0189b94982`.

## Revisions

- Initial specification written after reproducing the production 500 and observing Cloudflare's explicit rejection of `redirect: "error"`.
