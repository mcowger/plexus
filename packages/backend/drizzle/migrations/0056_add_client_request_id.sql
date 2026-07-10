ALTER TABLE `request_usage` ADD `client_request_id` text;--> statement-breakpoint
CREATE INDEX `idx_request_usage_client_request_id` ON `request_usage` (`client_request_id`);