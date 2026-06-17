ALTER TABLE `mcp_servers` ADD `mode` text DEFAULT 'remote_http' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `launcher` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `package_name` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `args` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `env` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `port` integer;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `path` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `startup_timeout_ms` integer;