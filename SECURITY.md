# Security policy

## Supported versions

Kanby is currently an early beta. Security fixes are applied to the latest revision on `main`; older commits and self-hosted deployments are not maintained as separate release lines yet.

## Reporting a vulnerability

Please privately report a vulnerability through [GitHub private vulnerability reporting](https://github.com/AmazingAng/kanby/security/advisories/new). Do not include secrets or private repository contents beyond the minimum reproduction needed.

Include the affected route or component, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within seven days. Please allow time for investigation and a coordinated fix before public disclosure.

## Credential exposure

If a GitHub OAuth secret, GitHub App private key, webhook secret, session secret, or Kanby Agent Token may have been exposed, revoke or rotate it immediately. Removing it from the latest commit is not enough because Git history, forks, caches, and build logs may retain it.

Kanby will never ask you to paste production secrets into a public issue.
