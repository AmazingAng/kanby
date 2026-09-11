ALTER TABLE `tasks` ADD `parent_task_id` text;--> statement-breakpoint
CREATE INDEX `idx_tasks_project_parent` ON `tasks` (`project_id`,`parent_task_id`);