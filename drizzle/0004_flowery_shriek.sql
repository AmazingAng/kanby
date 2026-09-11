CREATE TABLE `github_connection_states` (
	`state` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_connection_states_expires` ON `github_connection_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `github_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_github_deliveries_received` ON `github_deliveries` (`received_at`);--> statement-breakpoint
CREATE TABLE `github_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`kind` text NOT NULL,
	`action` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`url` text,
	`actor_login` text NOT NULL,
	`actor_avatar_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_events_project_created` ON `github_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `github_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text NOT NULL,
	`html_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_installations_account` ON `github_installations` (`account_id`);--> statement-breakpoint
CREATE TABLE `github_project_installations` (
	`project_id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`connected_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_project_installations_installation` ON `github_project_installations` (`installation_id`);--> statement-breakpoint
CREATE TABLE `github_project_repositories` (
	`project_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_github_project_repositories_pair` ON `github_project_repositories` (`project_id`,`repository_id`);--> statement-breakpoint
CREATE INDEX `idx_github_project_repositories_repository` ON `github_project_repositories` (`repository_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `github_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`html_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`private` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_repositories_installation` ON `github_repositories` (`installation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_github_repositories_full_name` ON `github_repositories` (`full_name`);--> statement-breakpoint
CREATE TABLE `github_task_links` (
	`task_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_number` integer NOT NULL,
	`branch` text,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`ci_status` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_github_task_links_project` ON `github_task_links` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_github_task_links_item` ON `github_task_links` (`repository_id`,`kind`,`item_number`);