# Kanby avatar release — 2026-11-28

The user-selected task-card and lime-sparkle avatar replaces the web brand mark
on the home page, shared app header, board and sign-in screen. Browser and Apple
touch icons use the same versioned PNG. The original artwork is preserved at
`public/kanby-avatar-v1.png` (1254 × 1254, 1,179,750 bytes).

Implementation `8d9ae3d` is merged into `main` and pushed to origin. The clean
main-based checkout passed all 19 release-gauntlet layers, including 320 tests,
TypeScript, lint, formatting, mutation checks and Worker build. The production
dependency audit found zero vulnerabilities. No new dependencies or database
changes were introduced.

Production intentionally contains only this avatar change on top of the prior
live implementation `69b6e54`. Its source snapshot is `02bab89`; the mini-program
work on main remains undeployed, pending registration and device verification.
Future releases must account for that difference and the pending 0020 migration.

- Worker: `3ef2459b-f47d-4a59-a46f-8dc132346df4`.
- Immutable artifact: `fe46352b-257b-4f77-b86c-4a4e2a914dcc`.
- Artifact SHA-256:
  `9650e8e24391c2a0cc63c90917112801e65eb856b58c490452e45fe8331523d8`.
- Preview deployment: `17897812-0af6-4203-9c81-4d3ef50c4523` (ACTIVE).
- Production deployment: `b59bec61-8b99-4c9a-8415-de9e674774ce` (ACTIVE).

Preview and production use the same artifact. The production domain and native
Worker domain return the byte-identical PNG with HTTP 200 and `image/png`.
Home-page HTML advertises both icon relations. Chrome verification confirmed
the new image on the production home page and the authenticated xAPI turn queue,
and on the preview board and sign-in screen. The authenticated queue still loads
the existing tasks. Initial HTTP HTML for client-loaded routes contains a loading
placeholder; their avatar rendering was checked in the browser after hydration.

Production D1 and R2 resource identities are unchanged. Exactly one production
native scheduled handler remains enabled; the preview schedule and legacy HTTP
schedule are paused. No migration, credential update or mini-program release was
performed. Deployment responses are retained in ignored private release outputs.
