# Kanby security hardening evidence

Date: 2026-09-12  
Branch: `codex/security-hardening`  
Base revision: `d8076e2`  
Validated source state: `37b77d9c81ddb76c07a2eb817f04685499dc754c7017e0203a8ff4e62d4d401d` across 230 non-generated, non-evidence files.

## Findings repaired

| Severity | Finding                                                                                                                                                                    | Repair and proof                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | OAuth `returnTo` accepted backslash and scheme-relative forms that a browser can normalize to another origin.                                                              | Canonical same-origin parsing is shared by OAuth start/callback; hostile forms are covered by `tests/auth-security.test.ts`.                                                                                           |
| High     | Browser and Agent mutation routes used unbounded `request.json()`, allowing a valid low-privilege credential to consume Worker memory and malformed input to become a 500. | Every JSON mutation now uses byte-bounded streaming parse (64 KiB default, smaller existing limits retained), exact JSON media-type checks, and consistent 400/413 responses. Route-level tests prove no write occurs. |
| Medium   | A malformed percent-encoded session cookie threw before session verification.                                                                                              | Cookie decoding now fails closed; session tokens require exactly two segments and valid issued-at/expiry bounds.                                                                                                       |
| Medium   | The public session endpoint returned server-only GitHub organization-admin account claims.                                                                                 | The endpoint serializes an explicit public-user projection only.                                                                                                                                                       |
| Medium   | A 30-day-old organization-admin snapshot could authorize a new GitHub App installation.                                                                                    | GitHub App connection now requires authentication no older than 15 minutes and returns through the same safe OAuth path.                                                                                               |
| Medium   | Any project owner could manually trigger the global GitHub recovery queue.                                                                                                 | Interactive recovery claims only deliveries belonging to the selected project; scheduled recovery remains global and webhook-secret authenticated.                                                                     |
| Medium   | Authenticated GitHub API and CLI requests could follow redirects; the CLI also accepted non-loopback HTTP server URLs.                                                     | GitHub/CLI requests reject redirects. CLI origins require HTTPS except loopback development and reject credentials, paths, queries, and fragments.                                                                     |
| Medium   | Authentication configuration accepted weak session secrets, insecure production HTTP, and origin strings whose path or credentials were silently discarded.                | Session secrets require at least 32 UTF-8 bytes; production origins require clean HTTPS origins, with loopback HTTP allowed for development. Deployment documentation was updated.                                     |
| Low      | Attachment multipart parsing could throw on a wrong/malformed media type, and an attacker-controlled MIME value was stored without normalization.                          | Uploads require multipart form data, malformed forms return 400, and stored MIME types are normalized to a bounded token or `application/octet-stream`.                                                                |

## RED to GREEN evidence

The first focused run failed 7 checks: missing safe-return and bounded-JSON helpers, an uncaught malformed cookie, accepted weak configuration, leaked claims, and an Agent route throwing on malformed JSON. After implementation, the focused security suites passed, followed by the full suite.

Final executable evidence:

- 26 test files and 137 unit/integration/property/concurrency tests passed.
- Changed-module coverage passed: 91.60% statements, 87.76% branches, 98.48% functions, and 94.86% lines.
- 50/50 mutation probes were killed, including nine new security-sensitive probes.
- TypeScript, lint, formatting, randomized test order, CLI credential contract, Worker production build, and recovery-schedule validation passed.
- Production dependency audit reported zero vulnerabilities.
- Secret scanning passed across 234 files and reachable Git history, including its synthetic negative control.
- Complete result: `GAUNTLET PASS: 12/12 layers`.

## Review notes and residual risk

- The full dependency tree still reports four moderate development-only advisories through the legacy `drizzle-kit` loader chain. Production dependencies report zero vulnerabilities; the suggested forced fix is a breaking downgrade, so this was not applied.
- The generated Vinext/React application currently needs inline bootstrap/style behavior, so CSP retains `unsafe-inline`. User Markdown disables raw HTML, React escapes user content, frames and objects are denied, and the remaining CSP limitation should be revisited when the framework supports a nonce/hash pipeline.
- Browser sessions remain stateless and valid for up to 30 days. Removing a project member is enforced immediately by database membership checks, but changing only the global GitHub allowlist does not revoke an already-issued session. A server-side session registry would be needed for immediate global revocation.
- Attachment aggregate size enforcement relies on Cloudflare's authoritative inbound `Content-Length`; chunked/missing-length uploads are rejected.

No production service, credential, GitHub configuration, or database was changed during this review.
