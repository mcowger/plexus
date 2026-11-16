PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`object` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`input_items` text,
	`output_items` text NOT NULL,
	`instructions` text,
	`temperature` real,
	`top_p` real,
	`max_output_tokens` integer,
	`top_logprobs` integer,
	`parallel_tool_calls` integer,
	`tool_choice` text,
	`tools` text,
	`text_config` text,
	`reasoning_config` text,
	`usage_input_tokens` integer,
	`usage_output_tokens` integer,
	`usage_reasoning_tokens` integer,
	`usage_cached_tokens` integer,
	`usage_total_tokens` integer,
	`previous_response_id` text,
	`conversation_id` text,
	`store` integer DEFAULT 0 NOT NULL,
	`background` integer DEFAULT 0 NOT NULL,
	`truncation` text,
	`incomplete_details` text,
	`error` text,
	`safety_identifier` text,
	`service_tier` text,
	`prompt_cache_key` text,
	`prompt_cache_retention` text,
	`metadata` text,
	`plexus_provider` text,
	`plexus_target_model` text,
	`plexus_api_type` text,
	`plexus_canonical_model` text
);
--> statement-breakpoint
INSERT INTO `__new_responses`("id", "object", "created_at", "completed_at", "status", "model", "input_items", "output_items", "instructions", "temperature", "top_p", "max_output_tokens", "top_logprobs", "parallel_tool_calls", "tool_choice", "tools", "text_config", "reasoning_config", "usage_input_tokens", "usage_output_tokens", "usage_reasoning_tokens", "usage_cached_tokens", "usage_total_tokens", "previous_response_id", "conversation_id", "store", "background", "truncation", "incomplete_details", "error", "safety_identifier", "service_tier", "prompt_cache_key", "prompt_cache_retention", "metadata", "plexus_provider", "plexus_target_model", "plexus_api_type", "plexus_canonical_model") SELECT "id", "object", "created_at", "completed_at", "status", "model", NULL, "output_items", "instructions", "temperature", "top_p", "max_output_tokens", "top_logprobs", "parallel_tool_calls", "tool_choice", "tools", "text_config", "reasoning_config", "usage_input_tokens", "usage_output_tokens", "usage_reasoning_tokens", "usage_cached_tokens", "usage_total_tokens", "previous_response_id", "conversation_id", "store", "background", "truncation", "incomplete_details", "error", "safety_identifier", "service_tier", "prompt_cache_key", "prompt_cache_retention", "metadata", "plexus_provider", "plexus_target_model", "plexus_api_type", "plexus_canonical_model" FROM `responses`;--> statement-breakpoint
DROP TABLE `responses`;--> statement-breakpoint
ALTER TABLE `__new_responses` RENAME TO `responses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_responses_conversation` ON `responses` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_responses_created_at` ON `responses` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_responses_status` ON `responses` (`status`);--> statement-breakpoint
CREATE INDEX `idx_responses_previous` ON `responses` (`previous_response_id`);