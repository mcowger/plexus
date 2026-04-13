ALTER TABLE "inference_errors" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "debug_logs" ADD COLUMN "api_key" text;--> statement-breakpoint
UPDATE "inference_errors" SET "api_key" = (SELECT "api_key" FROM "request_usage" WHERE "request_usage"."request_id" = "inference_errors"."request_id") WHERE "api_key" IS NULL;--> statement-breakpoint
UPDATE "debug_logs" SET "api_key" = (SELECT "api_key" FROM "request_usage" WHERE "request_usage"."request_id" = "debug_logs"."request_id") WHERE "api_key" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_usage_api_key" ON "request_usage" ("api_key", "start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inference_errors_api_key" ON "inference_errors" ("api_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_debug_logs_api_key" ON "debug_logs" ("api_key");
