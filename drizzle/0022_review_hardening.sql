CREATE TABLE `session_revocations` (
	`sid` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_session_revocations_expiry` ON `session_revocations` (`expires_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `last_task_number` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `sessions_revoked_at` integer;--> statement-breakpoint
UPDATE `projects` SET `last_task_number` = COALESCE((SELECT MAX(`task_number`) FROM `tasks` WHERE `tasks`.`project_id` = `projects`.`id`), 0);
