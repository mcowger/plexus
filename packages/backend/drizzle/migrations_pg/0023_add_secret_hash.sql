ALTER TABLE "api_keys" ADD COLUMN "secret_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_secret_hash_unique" ON "api_keys" ("secret_hash");