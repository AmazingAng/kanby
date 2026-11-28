# GitHub delivery pilot

From a connected project's board, open **GitHub 动态**, paste an Issue URL and choose **导入**. Kanby reopens an existing card when the Issue is already imported. In the card, the **GitHub Issue / PR** panel lists each link independently. Agents can put `Kanby-Task: xapi/KANBY-123` on its own line in a PR body. Use the project's actual URL slug.

The GitHub App must subscribe to **Pull request review** as well as **Pull request**. The existing Pull requests read permission supports both subscriptions. In Kanby, choose one already connected repository under **Settings → GitHub → Review 与验收试点仓库**. GitHub reviewers and PR authors must have signed in to Kanby and joined the project before a handoff can reach them.

Use a disposable Issue and two linked PRs for the smoke test. Ask a project member for review, submit a request for changes and verify the turns in both members’ queues. Merge the PRs and verify that the first merge leaves the card open. Once all linked PRs are merged and a linked pilot PR has reached the default branch, the card enters the owner's **待验收** queue. The owner confirms acceptance in Kanby. Remove an abandoned PR link if it is no longer part of the delivery.

## Rollout

Migration `0021_github_delivery_pilot.sql` replaces the single-link primary key while preserving existing rows and recovering imported Issue links. Apply the entire file atomically, after backing up and verifying the target D1. In a temporary `drizzle` directory for an existing xAPI environment, include only explicitly pending migrations. Previous Kanby migrations may have used a different import ledger. Confirm the preview database is separate, start from schema 0020, apply 0021, and verify the import smoke test before preparing the production cutover.

For production, schedule a write pause and take the final snapshot before applying the migration. Activate the tested preview artifact right after the database change. The old Worker expects a single-column conflict key, so rolling back only the Worker would break association writes. Before new writes, restore the pre-migration database snapshot with the previous Worker if needed. Once the new code accepts writes, preserve the multiple links and use a forward fix. Keep the pilot disabled until the GitHub App event subscription and chosen repository are confirmed.
