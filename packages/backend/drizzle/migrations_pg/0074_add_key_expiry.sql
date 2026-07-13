ALTER TABLE "api_keys" ADD COLUMN "expires_at" bigint;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "disabled_at" bigint;