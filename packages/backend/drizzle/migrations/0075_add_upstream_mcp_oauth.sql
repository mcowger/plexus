CREATE TABLE `mcp_upstream_oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`revision` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_upstream_oauth_grants` (
	`server_id` integer PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`version` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `upstream_oauth` text;--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `upstream_oauth_revision` text;