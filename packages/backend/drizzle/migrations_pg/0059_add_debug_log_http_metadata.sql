ALTER TABLE "debug_logs" ADD COLUMN "request_headers" text;--> statement-breakpoint
ALTER TABLE "debug_logs" ADD COLUMN "response_headers" text;--> statement-breakpoint
ALTER TABLE "debug_logs" ADD COLUMN "response_status" integer;