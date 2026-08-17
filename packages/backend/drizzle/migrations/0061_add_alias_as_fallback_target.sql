PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_model_alias_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias_id` integer NOT NULL,
	`provider_slug` text,
	`model_name` text,
	`target_alias_slug` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`group_name` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`alias_id`) REFERENCES `model_aliases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_model_alias_targets`("id", "alias_id", "provider_slug", "model_name", "target_alias_slug", "enabled", "group_name", "sort_order") SELECT "id", "alias_id", "provider_slug", "model_name", NULL, "enabled", "group_name", "sort_order" FROM `model_alias_targets`;--> statement-breakpoint
DROP TABLE `model_alias_targets`;--> statement-breakpoint
ALTER TABLE `__new_model_alias_targets` RENAME TO `model_alias_targets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_alias_targets` ON `model_alias_targets` (`alias_id`,`provider_slug`,`model_name`);