# GitHub delivery pilot

The xAPI pilot follows an Issue through a Kanby card, one or more PRs, review and human acceptance. Use the existing GitHub App, test database, mutation runner and release gauntlet. No new dependencies.

- Import a selected repository’s Issue by URL or from its activity. Both entry points return the same card on repeated import. The project must select the repository and the caller must be a member.
- A card can retain its source Issue and several PRs. Verified updates are scoped to the exact repository and item. Existing links survive migration and `githubLink` remains available to older clients. Removing one explicit URL leaves the other links intact.
- Project owners can opt one selected repository into review handoffs. GitHub review requests go to the requested project member, matching by GitHub user ID. Changes requested go to the PR author when that user is a member. Both transitions require active linked PRs and current event data.
- In the pilot, closing an Issue or closing a PR without merging cannot complete a card. After all linked PRs have merged and at least one pilot PR merged into the default branch, turn the card over to its current owner for acceptance. Kanby still requires explicit acceptance. Outside the pilot, existing completion rules continue.
- A replay must not restart an existing handoff or overwrite a newer manual handoff. Archived or completed cards do not acquire new turns. A GitHub event cannot cross a project or installation boundary. History backfill may update metadata but must not create turns.
- Verify migration of preexisting links, the signed webhook flow, scope and ordering controls, compatibility with the existing suite, and the repository release gauntlet. The proposed workflow was accepted in chat. This executable specification is recorded for the autonomous run and has not been separately reviewed.
