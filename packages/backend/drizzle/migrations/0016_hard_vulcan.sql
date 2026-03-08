CREATE TABLE `provider_rate_limits` (
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`current_budget` integer NOT NULL,
	`last_refill_at` integer NOT NULL,
	`queue_depth` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `model`)
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limits_last_refill` ON `provider_rate_limits` (`last_refill_at`);