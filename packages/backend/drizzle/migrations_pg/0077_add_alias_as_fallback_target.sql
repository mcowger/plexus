ALTER TABLE "model_alias_targets" ALTER COLUMN "provider_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_alias_targets" ALTER COLUMN "model_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_alias_targets" ADD COLUMN "target_alias_slug" text;