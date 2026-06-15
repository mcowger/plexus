ALTER TABLE `debug_logs` ADD `request_headers` text;--> statement-breakpoint
ALTER TABLE `debug_logs` ADD `response_headers` text;--> statement-breakpoint
ALTER TABLE `debug_logs` ADD `response_status` integer;