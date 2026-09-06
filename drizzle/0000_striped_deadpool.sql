CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tag` text DEFAULT '产品' NOT NULL,
	`owner_id` text NOT NULL,
	`owner_login` text NOT NULL,
	`owner_name` text NOT NULL,
	`owner_avatar_url` text,
	`due` text,
	`status` text DEFAULT 'ideas' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status_position` ON `tasks` (`status`,`position`);--> statement-breakpoint
CREATE INDEX `idx_tasks_owner_id` ON `tasks` (`owner_id`);