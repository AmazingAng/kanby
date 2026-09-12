# Security policy

## Supported versions

Kanby is currently an early beta. Security fixes are applied to the latest revision on `main`; older commits and self-hosted deployments are not maintained as separate release lines yet.

## Reporting a vulnerability

Please privately report a vulnerability through [GitHub private vulnerability reporting](https://github.com/AmazingAng/kanby/security/advisories/new). Do not include secrets or private repository contents beyond the minimum reproduction needed.

Include the affected route or component, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within seven days. Please allow time for investigation and a coordinated fix before public disclosure.

## Credential exposure

If a GitHub OAuth secret, GitHub App private key, webhook secret, session secret, or Kanby Agent Token may have been exposed, revoke or rotate it immediately. Removing it from the latest commit is not enough because Git history, forks, caches, and build logs may retain it.

Kanby will never ask you to paste production secrets into a public issue.

## Deployment security assumptions

Production deployments require HTTPS and a session secret generated from at
least 32 random bytes. Browser JSON mutation bodies are capped at 64 KiB;
webhooks and attachments have separate documented limits in the application.
Authenticated GitHub API requests reject redirects so installation credentials
cannot be forwarded to another origin.

The CLI sends Agent Tokens only to HTTPS origins, except for loopback HTTP used
in local development, and it rejects redirects while authenticated.
