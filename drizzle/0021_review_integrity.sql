ALTER TABLE `github_redelivery_attempts` ADD `attempt_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD `recipient_key` text;--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_recipient` ON `notification_deliveries` (`recipient_key`,`created_at`);