CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`actor_login` text,
	`actor_avatar_url` text,
	`summary` text NOT NULL,
	`body` text,
	`metadata` text,
	`dedupe_key` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_events_task_created` ON `task_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_events_project_created` ON `task_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_events_project_dedupe` ON `task_events` (`project_id`,`dedupe_key`);