CREATE TABLE "pi_ai_custom_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "pi_ai_custom_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "pi_ai_custom_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "pi_ai_custom_models_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "generation" jsonb;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "generation" jsonb;