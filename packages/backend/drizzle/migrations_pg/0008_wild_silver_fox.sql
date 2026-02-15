ALTER TABLE "request_usage" ADD COLUMN "tokens_cache_write" integer;--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "cost_cache_write" real;