ALTER TABLE `request_usage` ADD `is_raw` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `request_method` text;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `request_path` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `raw_passthrough` text;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `allow_raw_passthrough` integer DEFAULT false NOT NULL;