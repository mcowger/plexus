ALTER TABLE "debug_logs" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "inference_errors" ADD COLUMN "api_key" text;--> statement-breakpoint
CREATE INDEX "idx_request_usage_api_key" ON "request_usage" USING btree ("api_key","start_time");--> statement-breakpoint
CREATE INDEX "idx_debug_logs_api_key" ON "debug_logs" USING btree ("api_key");--> statement-breakpoint
CREATE INDEX "idx_inference_errors_api_key" ON "inference_errors" USING btree ("api_key");--> statement-breakpoint
ALTER TABLE "request_usage" DROP COLUMN "provider_reported_cost";