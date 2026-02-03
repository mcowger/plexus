CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"items" text NOT NULL,
	"metadata" text,
	"plexus_account_id" text
);
--> statement-breakpoint
CREATE TABLE "response_items" (
	"id" text PRIMARY KEY NOT NULL,
	"response_id" text NOT NULL,
	"item_index" integer NOT NULL,
	"item_type" text NOT NULL,
	"item_data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" text PRIMARY KEY NOT NULL,
	"object" text NOT NULL,
	"created_at" bigint NOT NULL,
	"completed_at" bigint,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"output_items" text NOT NULL,
	"instructions" text,
	"temperature" real,
	"top_p" real,
	"max_output_tokens" integer,
	"top_logprobs" integer,
	"parallel_tool_calls" integer,
	"tool_choice" text,
	"tools" text,
	"text_config" text,
	"reasoning_config" text,
	"usage_input_tokens" integer,
	"usage_output_tokens" integer,
	"usage_reasoning_tokens" integer,
	"usage_cached_tokens" integer,
	"usage_total_tokens" integer,
	"previous_response_id" text,
	"conversation_id" text,
	"store" integer DEFAULT 1 NOT NULL,
	"background" integer DEFAULT 0 NOT NULL,
	"truncation" text,
	"incomplete_details" text,
	"error" text,
	"safety_identifier" text,
	"service_tier" text,
	"prompt_cache_key" text,
	"prompt_cache_retention" text,
	"metadata" text,
	"plexus_provider" text,
	"plexus_target_model" text,
	"plexus_api_type" text,
	"plexus_canonical_model" text
);
--> statement-breakpoint
CREATE INDEX "idx_conversations_updated" ON "conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_response_items_response" ON "response_items" USING btree ("response_id","item_index");--> statement-breakpoint
CREATE INDEX "idx_response_items_type" ON "response_items" USING btree ("item_type");--> statement-breakpoint
CREATE INDEX "idx_responses_conversation" ON "responses" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_responses_created_at" ON "responses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_responses_status" ON "responses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_responses_previous" ON "responses" USING btree ("previous_response_id");