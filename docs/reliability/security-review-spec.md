# Kanby security hardening executable specification

Date: 2026-09-12  
Assurance tier: 3 (authentication, authorization, private repositories, and public APIs)  
Spec approval: autonomous because the user requested review and repair in one turn; explicit pre-implementation approval was not available.

## Scope and trust boundaries

This review covers the current public Kanby Worker application at source revision `d8076e2`: GitHub OAuth and GitHub App callbacks, signed browser sessions, project authorization, Agent Token endpoints, webhook ingestion, attachment delivery, browser mutation APIs, rendered task content, deployment headers, dependencies, and committed-secret history.

Production deployment, production data, credentials, GitHub settings, and repository history are out of mutation scope. Work is performed on the isolated `codex/security-hardening` worktree.

## Failure model

- An unauthenticated internet client sends malformed cookies, headers, URLs, and request bodies.
- An authenticated but untrusted project member sends malformed or unbounded JSON.
- A valid Agent Token is compromised or intentionally abuses resource limits.
- An OAuth attacker supplies a return path that browsers normalize to another origin.
- A browser consumer reads the session endpoint and receives server-only authorization claims.
- GitHub API endpoints respond with redirects or malformed/error payloads.
- A dependency or committed file contains a known production vulnerability or credential.

## Required invariants

1. OAuth completion redirects only to a canonical path on `PUBLIC_APP_ORIGIN`; scheme-relative and backslash-normalized external targets are rejected.
2. Malformed cookies and malformed session-token encodings fail closed without throwing.
3. Session tokens have exactly two segments, a valid issued-at/expiry window, and are signed with a deployment secret of at least 32 UTF-8 bytes.
4. Production origins require HTTPS. Plain HTTP is allowed only for loopback development hosts, and origin configuration may not silently discard credentials, paths, queries, or fragments.
5. `/api/auth/session` exposes only public profile fields, never GitHub organization-administrator authorization claims.
6. JSON APIs accept the JSON media type, reject malformed JSON with 400, reject bodies above a documented bound with 413, and never call unbounded `request.json()`.
7. Agent idempotency is computed from the exact bounded request bytes that are parsed, so replay semantics cannot diverge from execution semantics.
8. Authenticated GitHub API requests do not follow redirects.
9. Existing tenant boundaries, webhook signature verification/deduplication, attachment authorization, Markdown HTML suppression, CSP/security headers, and task concurrency behavior remain intact.
10. No production dependency has a known high-severity advisory and no live secret is present in tracked content or reachable Git history.

## Observable acceptance checks

- Unit/property tests cover hostile return targets, malformed cookies/tokens, origin/secret boundary values, JSON media types, exact body-size boundaries, malformed JSON, public session serialization, and GitHub redirect policy.
- Representative browser and Agent routes prove oversize/malformed input is rejected before a database write.
- Existing test, coverage, type, lint, formatting, mutation, dependency-audit, secret-scan, randomized-order, Worker-build, and schedule checks pass.
- Security-sensitive comparisons added by this change have mutation tests.

## Postconditions

- No credential is printed, committed, or copied into evidence.
- The validated source state and exact gauntlet result are recorded in a dedicated evidence artifact.
- Any accepted residual risk is explicit, especially the framework-required inline-script CSP allowance and development-only transitive advisories.
