# Kanby collaboration preferences

- After completing a requested update and passing the appropriate checks, automatically commit the changes, merge them into `main`, and push `main` to `origin`. Do not ask for confirmation again for this routine workflow.
- Include only changes belonging to the current request. Preserve unrelated work; use an isolated worktree when necessary.
- Fetch the latest remote state before merging. Do not force-push or bypass failing checks or branch protections. Report the resulting commit and remote status.
