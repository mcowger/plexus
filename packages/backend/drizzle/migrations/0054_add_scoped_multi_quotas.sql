PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quota_state` (
	`key_name` text NOT NULL,
	`quota_name` text NOT NULL,
	`limit_type` text NOT NULL,
	`current_usage` real DEFAULT 0 NOT NULL,
	`last_updated` integer NOT NULL,
	`window_start` integer,
	PRIMARY KEY(`key_name`, `quota_name`)
);
--> statement-breakpoint
INSERT INTO `__new_quota_state`("key_name", "quota_name", "limit_type", "current_usage", "last_updated", "window_start") SELECT "key_name", "quota_name", "limit_type", "current_usage", "last_updated", "window_start" FROM `quota_state`;--> statement-breakpoint
DROP TABLE `quota_state`;--> statement-breakpoint
ALTER TABLE `__new_quota_state` RENAME TO `quota_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `quota_names` text;--> statement-breakpoint
ALTER TABLE `user_quota_definitions` ADD `allowed_models` text;--> statement-breakpoint
ALTER TABLE `user_quota_definitions` ADD `allowed_providers` text;--> statement-breakpoint
ALTER TABLE `user_quota_definitions` ADD `excluded_models` text;--> statement-breakpoint
ALTER TABLE `user_quota_definitions` ADD `excluded_providers` text;--> statement-breakpoint
ALTER TABLE `user_quota_definitions` ADD `shared` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_quota_definitions` ADD `warn_at` real;