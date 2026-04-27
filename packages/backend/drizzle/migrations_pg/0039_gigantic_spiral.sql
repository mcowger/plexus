CREATE TABLE "meter_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"checker_id" text NOT NULL,
	"checker_type" text NOT NULL,
	"provider" text NOT NULL,
	"meter_key" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"label" text NOT NULL,
	"group" text,
	"scope" text,
	"limit" real,
	"used" real,
	"remaining" real,
	"utilization_state" text NOT NULL,
	"utilization_percent" real,
	"status" text NOT NULL,
	"period_value" integer,
	"period_unit" text,
	"period_cycle" text,
	"resets_at" bigint,
	"success" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"checked_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_meter_checker_meter_checked" ON "meter_snapshots" USING btree ("checker_id","meter_key","checked_at");--> statement-breakpoint
CREATE INDEX "idx_meter_provider_checked" ON "meter_snapshots" USING btree ("provider","checked_at");--> statement-breakpoint
CREATE INDEX "idx_meter_checked_at" ON "meter_snapshots" USING btree ("checked_at");