CREATE TABLE "config_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"config" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "config_snapshots_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE INDEX "idx_config_name" ON "config_snapshots" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_config_created_at" ON "config_snapshots" USING btree ("created_at");
