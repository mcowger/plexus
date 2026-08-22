ALTER TABLE "providers" ALTER COLUMN "oauth_provider_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ALTER COLUMN "oauth_provider_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."oauth_provider_type";