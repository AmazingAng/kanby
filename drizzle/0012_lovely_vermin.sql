CREATE TABLE `task_assignees` (
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_assignees_task_user` ON `task_assignees` (`task_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_task_assignees_project_task_position` ON `task_assignees` (`project_id`,`task_id`,`position`);