-- The original `quota_state.key_name` PRIMARY KEY was declared inline
-- (no explicit constraint name), so Postgres assigned its default name:
-- `<table>_pkey`. Confirmed against the original CREATE TABLE in
-- 0012_nosy_wild_pack.sql (`"key_name" text PRIMARY KEY NOT NULL`).
ALTER TABLE "quota_state" DROP CONSTRAINT "quota_state_pkey";--> statement-breakpoint
ALTER TABLE "quota_state" ADD CONSTRAINT "quota_state_key_name_quota_name_pk" PRIMARY KEY("key_name","quota_name");--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "quota_names" text;--> statement-breakpoint
ALTER TABLE "user_quota_definitions" ADD COLUMN "allowed_models" text;--> statement-breakpoint
ALTER TABLE "user_quota_definitions" ADD COLUMN "allowed_providers" text;--> statement-breakpoint
ALTER TABLE "user_quota_definitions" ADD COLUMN "excluded_models" text;--> statement-breakpoint
ALTER TABLE "user_quota_definitions" ADD COLUMN "excluded_providers" text;--> statement-breakpoint
ALTER TABLE "user_quota_definitions" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_quota_definitions" ADD COLUMN "warn_at" real;