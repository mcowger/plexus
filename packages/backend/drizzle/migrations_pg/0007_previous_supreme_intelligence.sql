ALTER TABLE "request_usage" ADD COLUMN "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "final_attempt_provider" text;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "final_attempt_model" text;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "all_attempted_providers" text;--> statement-breakpoint
ALTER TABLE "provider_performance" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_performance" ADD COLUMN "success_count" integer DEFAULT 0 NOT NULL;