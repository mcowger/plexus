ALTER TABLE "request_usage" ADD COLUMN "vision_fallthrough_model" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "allowed_models" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "allowed_providers" text;