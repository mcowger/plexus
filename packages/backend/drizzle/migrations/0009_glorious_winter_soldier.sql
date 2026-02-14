CREATE TABLE `config_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_snapshots_name_unique` ON `config_snapshots` (`name`);--> statement-breakpoint
CREATE INDEX `idx_config_name` ON `config_snapshots` (`name`);--> statement-breakpoint
CREATE INDEX `idx_config_created_at` ON `config_snapshots` (`created_at`);
