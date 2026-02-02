ALTER TABLE "request_usage" ADD COLUMN "tools_defined" integer;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "message_count" integer;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "parallel_tool_calls_enabled" integer;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "tool_calls_count" integer;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "finish_reason" text;