CREATE TABLE `pi_ai_custom_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pi_ai_custom_providers_name_unique` ON `pi_ai_custom_providers` (`name`);--> statement-breakpoint
CREATE TABLE `pi_ai_custom_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pi_ai_custom_models_name_unique` ON `pi_ai_custom_models` (`name`);--> statement-breakpoint
ALTER TABLE `model_aliases` ADD `generation` text;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `generation` text;