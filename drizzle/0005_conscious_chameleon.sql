CREATE TABLE `agent_idempotency_keys` (
	`token_id` text NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_idempotency_token_key` ON `agent_idempotency_keys` (`token_id`,`key`);--> statement-breakpoint
CREATE INDEX `idx_agent_idempotency_created` ON `agent_idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scopes` text DEFAULT 'task:read,task:write' NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_tokens_hash` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_agent_tokens_project_created` ON `agent_tokens` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_tokens_user` ON `agent_tokens` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `task_agent_claims` (
	`task_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`token_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_agent_claims_project` ON `task_agent_claims` (`project_id`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `idx_task_agent_claims_token` ON `task_agent_claims` (`token_id`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `task_agent_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`token_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_agent_updates_task` ON `task_agent_updates` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_agent_updates_project` ON `task_agent_updates` (`project_id`,`created_at`);