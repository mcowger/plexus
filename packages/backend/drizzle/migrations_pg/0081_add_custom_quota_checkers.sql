CREATE TABLE "custom_checkers" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "quota_checker_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."quota_checker_type";