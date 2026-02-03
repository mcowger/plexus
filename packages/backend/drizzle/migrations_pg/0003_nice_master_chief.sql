CREATE TABLE "quota_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"checker_id" text NOT NULL,
	"group_id" text,
	"window_type" text NOT NULL,
	"checked_at" bigint NOT NULL,
	"limit" real,
	"used" real,
	"remaining" real,
	"utilization_percent" real,
	"unit" text,
	"resets_at" bigint,
	"status" text,
	"success" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_quota_provider_checked" ON "quota_snapshots" USING btree ("provider","checked_at");--> statement-breakpoint
CREATE INDEX "idx_quota_checker_window" ON "quota_snapshots" USING btree ("checker_id","window_type","checked_at");--> statement-breakpoint
CREATE INDEX "idx_quota_group_window" ON "quota_snapshots" USING btree ("group_id","window_type","checked_at");--> statement-breakpoint
CREATE INDEX "idx_quota_checked_at" ON "quota_snapshots" USING btree ("checked_at");