CREATE TABLE "request_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"date" text NOT NULL,
	"source_ip" text,
	"api_key" text,
	"attribution" text,
	"incoming_api_type" text,
	"provider" text,
	"incoming_model_alias" text,
	"canonical_model_name" text,
	"selected_model_name" text,
	"outgoing_api_type" text,
	"tokens_input" integer,
	"tokens_output" integer,
	"tokens_reasoning" integer,
	"tokens_cached" integer,
	"cost_input" real,
	"cost_output" real,
	"cost_cached" real,
	"cost_total" real,
	"cost_source" text,
	"cost_metadata" text,
	"start_time" bigint NOT NULL,
	"duration_ms" bigint,
	"ttft_ms" real,
	"tokens_per_sec" real,
	"is_streamed" integer DEFAULT 0 NOT NULL,
	"is_passthrough" integer DEFAULT 0 NOT NULL,
	"response_status" text,
	"tokens_estimated" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "request_usage_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "provider_cooldowns" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"account_id" text DEFAULT '' NOT NULL,
	"expiry" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "provider_cooldowns_provider_model_account_id_pk" PRIMARY KEY("provider","model","account_id")
);
--> statement-breakpoint
CREATE TABLE "debug_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"raw_request" text,
	"transformed_request" text,
	"raw_response" text,
	"transformed_response" text,
	"raw_response_snapshot" text,
	"transformed_response_snapshot" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"date" text NOT NULL,
	"error_message" text,
	"error_stack" text,
	"details" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request_id" text,
	"time_to_first_token_ms" real,
	"total_tokens" integer,
	"duration_ms" real,
	"tokens_per_sec" real,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_request_usage_date" ON "request_usage" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_request_usage_provider" ON "request_usage" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_request_usage_request_id" ON "request_usage" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_cooldowns_expiry" ON "provider_cooldowns" USING btree ("expiry");--> statement-breakpoint
CREATE INDEX "idx_debug_logs_request_id" ON "debug_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_debug_logs_created_at" ON "debug_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_errors_request_id" ON "inference_errors" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_errors_date" ON "inference_errors" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_provider_performance_lookup" ON "provider_performance" USING btree ("provider","model","created_at");