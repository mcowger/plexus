ALTER TYPE "public"."metadata_source" ADD VALUE 'custom';--> statement-breakpoint
CREATE TABLE "alias_metadata_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias_id" integer NOT NULL,
	"name" text,
	"description" text,
	"context_length" integer,
	"pricing_prompt" text,
	"pricing_completion" text,
	"pricing_input_cache_read" text,
	"pricing_input_cache_write" text,
	"architecture_input_modalities" jsonb,
	"architecture_output_modalities" jsonb,
	"architecture_tokenizer" text,
	"supported_parameters" jsonb,
	"top_provider_context_length" integer,
	"top_provider_max_completion_tokens" integer,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "uq_alias_metadata_overrides" UNIQUE("alias_id")
);
--> statement-breakpoint
ALTER TABLE "request_usage" ADD COLUMN "provider_reported_cost" real;--> statement-breakpoint
ALTER TABLE "alias_metadata_overrides" ADD CONSTRAINT "alias_metadata_overrides_alias_id_model_aliases_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."model_aliases"("id") ON DELETE cascade ON UPDATE no action;