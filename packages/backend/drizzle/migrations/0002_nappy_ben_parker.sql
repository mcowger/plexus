PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_cooldowns` (
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`expiry` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `model`)
);
--> statement-breakpoint
INSERT INTO `__new_provider_cooldowns`("provider", "model", "expiry", "created_at") SELECT "provider", "model", "expiry", "created_at" FROM `provider_cooldowns`;--> statement-breakpoint
DROP TABLE `provider_cooldowns`;--> statement-breakpoint
ALTER TABLE `__new_provider_cooldowns` RENAME TO `provider_cooldowns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_cooldowns_expiry` ON `provider_cooldowns` (`expiry`);