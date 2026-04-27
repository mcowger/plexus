CREATE TABLE `meter_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checker_id` text NOT NULL,
	`checker_type` text NOT NULL,
	`provider` text NOT NULL,
	`meter_key` text NOT NULL,
	`kind` text NOT NULL,
	`unit` text NOT NULL,
	`label` text NOT NULL,
	`group` text,
	`scope` text,
	`limit` real,
	`used` real,
	`remaining` real,
	`utilization_state` text NOT NULL,
	`utilization_percent` real,
	`status` text NOT NULL,
	`period_value` integer,
	`period_unit` text,
	`period_cycle` text,
	`resets_at` integer,
	`success` integer DEFAULT true NOT NULL,
	`error_message` text,
	`checked_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meter_checker_meter_checked` ON `meter_snapshots` (`checker_id`,`meter_key`,`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_meter_provider_checked` ON `meter_snapshots` (`provider`,`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_meter_checked_at` ON `meter_snapshots` (`checked_at`);