ALTER TABLE `providers` ADD `model_autosync_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `model_autosync_interval` integer DEFAULT 60 NOT NULL;