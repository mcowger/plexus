ALTER TABLE "a2a_push_notification_configs" ADD COLUMN "owner_key" text NOT NULL DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD COLUMN "owner_key" text NOT NULL DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD COLUMN "owner_attribution" text;--> statement-breakpoint
CREATE INDEX "idx_a2a_push_configs_owner_key" ON "a2a_push_notification_configs" USING btree ("owner_key");--> statement-breakpoint
CREATE INDEX "idx_a2a_tasks_owner_key" ON "a2a_tasks" USING btree ("owner_key");
