CREATE TABLE `mcp_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mcp_server_id` integer NOT NULL,
	`key` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`cooldown_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `rate_limit_cooldown_ms` integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `quota_cooldown_ms` integer DEFAULT 86400000 NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `auth_scheme` text;