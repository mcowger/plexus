CREATE TABLE `alias_metadata_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias_id` integer NOT NULL,
	`name` text,
	`description` text,
	`context_length` integer,
	`pricing_prompt` text,
	`pricing_completion` text,
	`pricing_input_cache_read` text,
	`pricing_input_cache_write` text,
	`architecture_input_modalities` text,
	`architecture_output_modalities` text,
	`architecture_tokenizer` text,
	`supported_parameters` text,
	`top_provider_context_length` integer,
	`top_provider_max_completion_tokens` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`alias_id`) REFERENCES `model_aliases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_alias_metadata_overrides` ON `alias_metadata_overrides` (`alias_id`);
