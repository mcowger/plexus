CREATE TABLE `mcp_oauth_authorization_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code_hash` text NOT NULL,
	`code` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text,
	`key_name` text NOT NULL,
	`api_key_secret_hash` text,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_authorization_codes_code_hash_unique` ON `mcp_oauth_authorization_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_authorization_codes_client_id` ON `mcp_oauth_authorization_codes` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_authorization_codes_expires_at` ON `mcp_oauth_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text,
	`redirect_uris` text NOT NULL,
	`grant_types` text,
	`response_types` text,
	`scope` text,
	`token_endpoint_auth_method` text DEFAULT 'none' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_clients_client_id_unique` ON `mcp_oauth_clients` (`client_id`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`access_token_hash` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`refresh_token` text NOT NULL,
	`client_id` text NOT NULL,
	`key_name` text NOT NULL,
	`api_key_secret_hash` text,
	`resource` text NOT NULL,
	`scope` text,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_tokens_access_token_hash_unique` ON `mcp_oauth_tokens` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_tokens_refresh_token_hash_unique` ON `mcp_oauth_tokens` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_tokens_client_id` ON `mcp_oauth_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_tokens_key_name` ON `mcp_oauth_tokens` (`key_name`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_tokens_access_token_expires_at` ON `mcp_oauth_tokens` (`access_token_expires_at`);