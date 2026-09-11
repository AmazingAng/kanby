CREATE TABLE `github_automation_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`issue_task_creation` integer DEFAULT 1 NOT NULL,
	`auto_link_pull_requests` integer DEFAULT 1 NOT NULL,
	`pull_request_open_status` text DEFAULT 'building',
	`completion_status` text DEFAULT 'shipped',
	`show_ci_failures` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_automation_updated` ON `github_automation_settings` (`updated_at`);--> statement-breakpoint
CREATE TABLE `github_issue_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`item_number` integer NOT NULL,
	`task_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_github_issue_imports_item` ON `github_issue_imports` (`project_id`,`repository_id`,`item_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_github_issue_imports_task` ON `github_issue_imports` (`task_id`);--> statement-breakpoint
ALTER TABLE `github_events` ADD `item_number` integer;