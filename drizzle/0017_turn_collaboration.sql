ALTER TABLE `tasks` ADD `turn_kind` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `turn_user_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `turn_token_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `turn_reason` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `turn_note` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `turn_since` integer;
--> statement-breakpoint
CREATE INDEX `idx_tasks_project_turn` ON `tasks` (`project_id`,`turn_user_id`,`turn_since`);
--> statement-breakpoint
CREATE TABLE `task_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`event_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`target_token_id` text,
	`target_kind` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_task_mentions_target` ON `task_mentions` (`project_id`,`target_user_id`,`resolved_at`);
--> statement-breakpoint
CREATE INDEX `idx_task_mentions_task` ON `task_mentions` (`task_id`,`resolved_at`);
--> statement-breakpoint
CREATE TABLE `task_read_cursors` (
	`task_id` text NOT NULL,
	`reader_id` text NOT NULL,
	`project_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `reader_id`)
);
--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`webhook_url` text NOT NULL,
	`secret` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_channels_project` ON `notification_channels` (`project_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`task_id` text,
	`event_kind` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_project` ON `notification_deliveries` (`project_id`,`created_at`);
--> statement-breakpoint
UPDATE `tasks` SET
	`turn_kind` = 'member',
	`turn_user_id` = COALESCE(
		(SELECT a.user_id FROM task_assignees a WHERE a.project_id = tasks.project_id AND a.task_id = tasks.id ORDER BY a.position, a.created_at, a.user_id LIMIT 1),
		tasks.owner_id),
	`turn_reason` = CASE WHEN EXISTS (
		SELECT 1 FROM task_events e
		WHERE e.id = (
			SELECT r.id FROM task_events r
			WHERE r.project_id = tasks.project_id AND r.task_id = tasks.id AND r.kind = 'agent.progress'
			ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
		AND (e.body LIKE '%待验收%' OR e.body LIKE '%待用户验收%' OR e.body LIKE '%等待验收%' OR e.body LIKE '%待人工验收%')
	) THEN 'awaiting_acceptance' ELSE 'developing' END,
	`turn_since` = COALESCE(
		(SELECT MAX(r.created_at) FROM task_events r WHERE r.project_id = tasks.project_id AND r.task_id = tasks.id AND r.kind = 'agent.progress'),
		tasks.updated_at)
WHERE `status` = 'building' AND `archived_at` IS NULL AND `turn_kind` IS NULL;
