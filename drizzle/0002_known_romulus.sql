CREATE TABLE `task_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_attachments_object_key` ON `task_attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_task_attachments_project_task` ON `task_attachments` (`project_id`,`task_id`,`created_at`);