CREATE TABLE `a2a_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`endpoint` text NOT NULL,
	`version` text NOT NULL,
	`capabilities` text,
	`skills` text,
	`default_input_modes` text,
	`default_output_modes` text,
	`additional_interfaces` text,
	`auth_config` text,
	`metadata` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_discovered_at` text,
	`last_healthy_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `a2a_agents_agent_id_unique` ON `a2a_agents` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_a2a_agents_endpoint` ON `a2a_agents` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_a2a_agents_enabled` ON `a2a_agents` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_a2a_agents_updated_at` ON `a2a_agents` (`updated_at`);--> statement-breakpoint
CREATE TABLE `a2a_push_notification_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`config_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`authentication` text,
	`metadata` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_a2a_push_configs_task_id` ON `a2a_push_notification_configs` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_a2a_push_configs_task_config` ON `a2a_push_notification_configs` (`task_id`,`config_id`);--> statement-breakpoint
CREATE TABLE `a2a_task_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`event_type` text NOT NULL,
	`sequence` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_a2a_task_events_task_id` ON `a2a_task_events` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_a2a_task_events_created_at` ON `a2a_task_events` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_a2a_task_events_task_sequence` ON `a2a_task_events` (`task_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `a2a_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text NOT NULL,
	`latest_message` text,
	`request_message` text,
	`artifacts` text,
	`metadata` text,
	`idempotency_key` text,
	`error_code` text,
	`error_message` text,
	`submitted_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`canceled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_a2a_tasks_context_id` ON `a2a_tasks` (`context_id`);--> statement-breakpoint
CREATE INDEX `idx_a2a_tasks_agent_id` ON `a2a_tasks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_a2a_tasks_status` ON `a2a_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_a2a_tasks_created_at` ON `a2a_tasks` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_a2a_tasks_idempotency_key` ON `a2a_tasks` (`idempotency_key`);