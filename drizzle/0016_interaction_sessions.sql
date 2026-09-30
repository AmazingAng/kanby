CREATE TABLE `interaction_collection` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `interaction_events` (
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`provenance` text NOT NULL,
	`input_json` text NOT NULL,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_interaction_event_id` ON `interaction_events` (`session_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_interaction_event_sequence` ON `interaction_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `interaction_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`token_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`client` text NOT NULL,
	`context` text,
	`task_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	`revision` integer NOT NULL,
	`last_event_id` text NOT NULL,
	`state_json` text NOT NULL,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_interaction_sessions_project` ON `interaction_sessions` (`project_id`,`created_at`,`id`);--> statement-breakpoint
INSERT INTO interaction_collection (id, started_at) VALUES (1, CAST(strftime('%s','now') AS INTEGER) * 1000);
