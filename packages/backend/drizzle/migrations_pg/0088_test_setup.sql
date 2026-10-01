ALTER TYPE "public"."selector_strategy" ADD VALUE 'auto';--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "auto_routing" jsonb;--> statement-breakpoint
ALTER TABLE "model_alias_targets" ADD COLUMN "auto_profile" jsonb;