# Kanby security release deployment specification

Date: 2026-09-12  
Assurance tier: 3 (production authentication and persistent user data)  
Approval: the user explicitly requested deployment of the repository version; this operational spec was produced autonomously from that authorization.

## Target and setup

- Deploy source commit `2fdc49e` to the existing Cloudflare Worker `kanby`.
- Preserve the existing production D1 database and R2 bucket bindings.
- Build with the deployed Worker origin `https://kanby.0xaa.workers.dev`; do not attach or change a custom domain.
- Add no dependency and run no D1 migration. Use the existing Wrangler authentication and documented deployment command.
- Rotate only `SESSION_SECRET` to at least 32 random bytes before deployment. This intentionally invalidates browser sessions but must not alter users, projects, tasks, GitHub links, or attachments.

## Failure model and acceptance checks

1. Record the active Worker version, D1 table/count baseline, and storage binding names before mutation.
2. Verify the repository is clean, `origin/main` is the target commit, there are no migration changes relative to the active application snapshot, and the 12-layer gauntlet is green.
3. Rebuild using the exact existing production D1/R2 names and identifiers; reject generated placeholder bindings before deployment.
4. Deploy to the existing Worker and verify its new version receives 100% traffic.
5. Confirm the home page and demo return 200, unauthenticated protected APIs fail closed, security headers remain present, and the hostile OAuth return path is reduced to `/` without printing OAuth state or verifier cookies.
6. Re-read D1 counts after deployment and require them to equal the baseline. No migration, delete, or write smoke test is permitted.
7. If build, deployment, HTTP, security, or data checks fail, stop and roll traffic back to Worker version `2ec258c1-a28f-44e8-8f26-ddefb505bcb3`.

## Must not

- Do not delete, recreate, migrate, import, or export production D1/R2 data.
- Do not modify GitHub OAuth/App/webhook credentials, installation configuration, DNS, routes, or `kanby.dev`.
- Do not print or persist the generated session secret.
