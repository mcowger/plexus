ALTER TABLE "model_alias_targets" ADD COLUMN "group_name" text;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "target_groups" jsonb;