# Kanby security release deployment evidence

Date: 2026-09-12  
Source commit: `2fdc49ebd704be26197a13118868a203ca03ed06`  
Previous Worker version: `2ec258c1-a28f-44e8-8f26-ddefb505bcb3`  
Deployed Worker version: `40f52bea-262c-4ca0-b263-6a0189b94982` at 100% traffic.

## Result

- Rotated `SESSION_SECRET` without printing or persisting its value. Existing browser sessions were intentionally invalidated; application data was not changed.
- Built with Worker `kanby`, D1 `kanby-db`, R2 `kanby-attachments`, and origin `https://kanby.0xaa.workers.dev`. A pre-deploy assertion rejected placeholder bindings.
- Ran no migration and no data-writing smoke test.
- D1 counts before and after were identical: 3 users, 2 projects, 4 memberships, 41 tasks, 0 attachments, and 5 GitHub task links. Both queries reported zero rows written.
- `/` and `/demo` returned 200 with CSP and HSTS.
- Anonymous `/api/auth/session` returned 200 with `user: null`; an invalid webhook signature returned 401.
- The previously reproducible hostile OAuth return path is now stored as `/`.
- Rollback was not needed.

The source had already passed the complete 12/12 gauntlet, 137 tests, 50/50 mutation probes, production dependency audit, secret scan, and GitHub CI before deployment. GitHub OAuth/App/webhook credentials, DNS, routes, `kanby.dev`, D1 rows, and R2 objects were not modified.
