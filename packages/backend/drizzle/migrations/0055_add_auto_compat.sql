ALTER TABLE `providers` ADD `auto_compat` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_models` ADD `auto_compat` integer;