CREATE TABLE `project_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`identity` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_invitations_project_identity` ON `project_invitations` (`project_id`,`identity`);--> statement-breakpoint
CREATE INDEX `idx_project_invitations_identity` ON `project_invitations` (`identity`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_members_project_user` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_project_members_user` ON `project_members` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_login` ON `users` (`login`);--> statement-breakpoint
DROP INDEX `idx_tasks_status_position`;--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_tasks_project_status_position` ON `tasks` (`project_id`,`status`,`position`);
