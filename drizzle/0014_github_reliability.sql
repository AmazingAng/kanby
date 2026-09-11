ALTER TABLE `tasks` ADD `task_number` integer;
--> statement-breakpoint
UPDATE tasks AS task
SET task_number = (
  SELECT COUNT(*)
  FROM tasks AS candidate
  WHERE candidate.project_id = task.project_id
    AND (
      candidate.created_at < task.created_at
      OR (candidate.created_at = task.created_at AND candidate.id <= task.id)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_project_number` ON `tasks` (`project_id`,`task_number`);
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `payload` text;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `attempt_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `last_error` text;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `next_retry_at` integer;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `lease_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `installation_id` text;
--> statement-breakpoint
ALTER TABLE `github_deliveries` ADD `repository_id` text;
--> statement-breakpoint
UPDATE github_deliveries
SET status = CASE WHEN processed_at IS NULL THEN 'failed' ELSE 'complete' END,
    updated_at = COALESCE(processed_at, received_at),
    next_retry_at = CASE WHEN processed_at IS NULL THEN received_at ELSE NULL END;
--> statement-breakpoint
CREATE INDEX `idx_github_deliveries_retry` ON `github_deliveries` (`status`,`next_retry_at`);
--> statement-breakpoint
CREATE TABLE `github_sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `item_count` integer NOT NULL DEFAULT 0,
  `error` text,
  `started_at` integer NOT NULL,
  `finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_github_sync_runs_project_started` ON `github_sync_runs` (`project_id`,`started_at`);
--> statement-breakpoint
CREATE TABLE `github_redelivery_attempts` (
  `delivery_id` text PRIMARY KEY NOT NULL,
  `guid` text NOT NULL,
  `attempted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_github_redelivery_guid` ON `github_redelivery_attempts` (`guid`);
