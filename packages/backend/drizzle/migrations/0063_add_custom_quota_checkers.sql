CREATE TABLE `custom_checkers` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`code` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
