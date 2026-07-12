ALTER TABLE "api_keys" ADD COLUMN "allow_raw_passthrough" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "is_raw" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "request_method" text;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "request_path" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "raw_passthrough" jsonb;