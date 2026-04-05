DROP INDEX "api_keys_secret_hash_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "secret_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "extra_body" jsonb;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_secret_hash_unique" UNIQUE("secret_hash");