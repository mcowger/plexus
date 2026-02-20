CREATE TABLE "a2a_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"endpoint" text NOT NULL,
	"version" text NOT NULL,
	"capabilities" text,
	"skills" text,
	"default_input_modes" text,
	"default_output_modes" text,
	"additional_interfaces" text,
	"auth_config" text,
	"metadata" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"last_discovered_at" timestamp,
	"last_healthy_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "a2a_agents_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "a2a_push_notification_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"config_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"authentication" text,
	"metadata" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "a2a_task_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"event_type" text NOT NULL,
	"sequence" integer NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "a2a_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"context_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"status" text NOT NULL,
	"latest_message" text,
	"request_message" text,
	"artifacts" text,
	"metadata" text,
	"idempotency_key" text,
	"error_code" text,
	"error_message" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_a2a_agents_endpoint" ON "a2a_agents" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "idx_a2a_agents_enabled" ON "a2a_agents" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_a2a_agents_updated_at" ON "a2a_agents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_a2a_push_configs_task_id" ON "a2a_push_notification_configs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_a2a_push_configs_task_config" ON "a2a_push_notification_configs" USING btree ("task_id","config_id");--> statement-breakpoint
CREATE INDEX "idx_a2a_task_events_task_id" ON "a2a_task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_a2a_task_events_created_at" ON "a2a_task_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_a2a_task_events_task_sequence" ON "a2a_task_events" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_context_id" ON "a2a_tasks" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_agent_id" ON "a2a_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_status" ON "a2a_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_created_at" ON "a2a_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_a2a_tasks_idempotency_key" ON "a2a_tasks" USING btree ("idempotency_key");