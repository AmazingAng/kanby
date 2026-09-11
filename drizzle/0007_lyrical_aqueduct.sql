ALTER TABLE `tasks` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `idx_tasks_project_archived` ON `tasks` (`project_id`,`archived_at`);