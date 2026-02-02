ALTER TABLE `request_usage` ADD `tools_defined` integer;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `message_count` integer;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `parallel_tool_calls_enabled` integer;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `tool_calls_count` integer;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `finish_reason` text;