ALTER TABLE `a2a_push_notification_configs` ADD `owner_key` text NOT NULL DEFAULT 'system';--> statement-breakpoint
CREATE INDEX `idx_a2a_push_configs_owner_key` ON `a2a_push_notification_configs` (`owner_key`);--> statement-breakpoint
ALTER TABLE `a2a_tasks` ADD `owner_key` text NOT NULL DEFAULT 'system';--> statement-breakpoint
ALTER TABLE `a2a_tasks` ADD `owner_attribution` text;--> statement-breakpoint
CREATE INDEX `idx_a2a_tasks_owner_key` ON `a2a_tasks` (`owner_key`);
