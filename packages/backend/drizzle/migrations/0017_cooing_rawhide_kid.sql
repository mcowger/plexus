ALTER TABLE `request_usage` ADD `is_vision_fallthrough` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `request_usage` ADD `is_descriptor_request` integer DEFAULT 0 NOT NULL;