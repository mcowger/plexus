ALTER TABLE `request_usage` ADD `attempt_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `final_attempt_provider` text;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `final_attempt_model` text;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `all_attempted_providers` text;--> statement-breakpoint
ALTER TABLE `provider_performance` ADD `failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_performance` ADD `success_count` integer DEFAULT 0 NOT NULL;