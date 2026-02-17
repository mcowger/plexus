CREATE TABLE `mcp_debug_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`raw_request_headers` text,
	`raw_request_body` text,
	`raw_response_headers` text,
	`raw_response_body` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_debug_logs_request_id_unique` ON `mcp_debug_logs` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_debug_logs_request_id` ON `mcp_debug_logs` (`request_id`);--> statement-breakpoint
CREATE TABLE `mcp_request_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	`start_time` integer NOT NULL,
	`duration_ms` integer,
	`server_name` text NOT NULL,
	`upstream_url` text NOT NULL,
	`method` text NOT NULL,
	`jsonrpc_method` text,
	`api_key` text,
	`attribution` text,
	`source_ip` text,
	`response_status` integer,
	`is_streamed` integer DEFAULT 0 NOT NULL,
	`has_debug` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_request_usage_request_id_unique` ON `mcp_request_usage` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_request_usage_server_name` ON `mcp_request_usage` (`server_name`);--> statement-breakpoint
CREATE INDEX `idx_mcp_request_usage_created_at` ON `mcp_request_usage` (`created_at`);