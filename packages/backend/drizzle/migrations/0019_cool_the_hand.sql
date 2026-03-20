CREATE TABLE `providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`display_name` text,
	`api_base_url` text,
	`api_key` text,
	`oauth_provider_type` text,
	`oauth_credential_id` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`disable_cooldown` integer DEFAULT 0 NOT NULL,
	`discount` real,
	`estimate_tokens` integer DEFAULT 0 NOT NULL,
	`headers` text,
	`extra_body` text,
	`quota_checker_type` text,
	`quota_checker_id` text,
	`quota_checker_enabled` integer DEFAULT 1 NOT NULL,
	`quota_checker_interval` integer DEFAULT 30 NOT NULL,
	`quota_checker_options` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`oauth_credential_id`) REFERENCES `oauth_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_unique` ON `providers` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_providers_slug` ON `providers` (`slug`);--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`pricing_config` text,
	`model_type` text,
	`access_via` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_provider_models` ON `provider_models` (`provider_id`,`model_name`);--> statement-breakpoint
CREATE TABLE `model_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`selector` text,
	`priority` text DEFAULT 'selector' NOT NULL,
	`model_type` text,
	`additional_aliases` text,
	`advanced` text,
	`metadata_source` text,
	`metadata_source_path` text,
	`use_image_fallthrough` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_aliases_slug_unique` ON `model_aliases` (`slug`);--> statement-breakpoint
CREATE TABLE `model_alias_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias_id` integer NOT NULL,
	`provider_slug` text NOT NULL,
	`model_name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`alias_id`) REFERENCES `model_aliases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_alias_targets` ON `model_alias_targets` (`alias_id`,`provider_slug`,`model_name`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`secret` text NOT NULL,
	`comment` text,
	`quota_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_name_unique` ON `api_keys` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_secret_unique` ON `api_keys` (`secret`);--> statement-breakpoint
CREATE TABLE `user_quota_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`quota_type` text NOT NULL,
	`limit_type` text NOT NULL,
	`limit_value` integer NOT NULL,
	`duration` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_quota_definitions_name_unique` ON `user_quota_definitions` (`name`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`upstream_url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`headers` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_unique` ON `mcp_servers` (`name`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oauth_provider_type` text NOT NULL,
	`account_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_oauth_credentials` ON `oauth_credentials` (`oauth_provider_type`,`account_id`);