CREATE TABLE `weixin_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ilink_bot_id` text NOT NULL,
	`ilink_user_enc` text NOT NULL,
	`bot_token_enc` text NOT NULL,
	`context_token_enc` text,
	`base_url` text NOT NULL,
	`updates_buf` text,
	`status` text NOT NULL,
	`last_error` text,
	`activated_at` integer,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weixin_logins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`qrcode` text NOT NULL,
	`base_url` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_weixin_logins_user` ON `weixin_logins` (`user_id`,`expires_at`);
