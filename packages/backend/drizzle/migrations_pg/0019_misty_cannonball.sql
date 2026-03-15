CREATE TYPE "public"."oauth_provider_type" AS ENUM('anthropic', 'openai-codex', 'github-copilot', 'google-gemini-cli', 'google-antigravity');--> statement-breakpoint
CREATE TYPE "public"."quota_checker_type" AS ENUM('naga', 'synthetic', 'nanogpt', 'zai', 'moonshot', 'minimax', 'minimax-coding', 'openrouter', 'kilo', 'openai-codex', 'claude-code', 'kimi-code', 'copilot', 'wisdomgate', 'apertis', 'poe', 'gemini-cli', 'antigravity');--> statement-breakpoint
CREATE TYPE "public"."model_type" AS ENUM('chat', 'embeddings', 'transcriptions', 'speech', 'image', 'responses');--> statement-breakpoint
CREATE TYPE "public"."alias_priority" AS ENUM('selector', 'api_match');--> statement-breakpoint
CREATE TYPE "public"."metadata_source" AS ENUM('openrouter', 'models.dev', 'catwalk');--> statement-breakpoint
CREATE TYPE "public"."selector_strategy" AS ENUM('random', 'in_order', 'cost', 'latency', 'usage', 'performance');--> statement-breakpoint
CREATE TYPE "public"."limit_type" AS ENUM('requests', 'tokens');--> statement-breakpoint
CREATE TYPE "public"."quota_type" AS ENUM('rolling', 'daily', 'weekly');--> statement-breakpoint
CREATE TABLE "providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text,
	"api_base_url" jsonb,
	"api_key" text,
	"oauth_provider_type" "oauth_provider_type",
	"oauth_credential_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"disable_cooldown" boolean DEFAULT false NOT NULL,
	"discount" real,
	"estimate_tokens" boolean DEFAULT false NOT NULL,
	"headers" jsonb,
	"extra_body" jsonb,
	"quota_checker_type" "quota_checker_type",
	"quota_checker_id" text,
	"quota_checker_enabled" boolean DEFAULT true NOT NULL,
	"quota_checker_interval" integer DEFAULT 30 NOT NULL,
	"quota_checker_options" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"model_name" text NOT NULL,
	"pricing_config" jsonb,
	"model_type" "model_type",
	"access_via" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_provider_models" UNIQUE("provider_id","model_name")
);
--> statement-breakpoint
CREATE TABLE "model_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"selector" "selector_strategy",
	"priority" "alias_priority" DEFAULT 'selector' NOT NULL,
	"model_type" text,
	"additional_aliases" jsonb,
	"advanced" jsonb,
	"metadata_source" "metadata_source",
	"metadata_source_path" text,
	"use_image_fallthrough" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "model_aliases_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "model_alias_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias_id" integer NOT NULL,
	"provider_slug" text NOT NULL,
	"model_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_alias_targets" UNIQUE("alias_id","provider_slug","model_name")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"secret" text NOT NULL,
	"comment" text,
	"quota_name" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "api_keys_name_unique" UNIQUE("name"),
	CONSTRAINT "api_keys_secret_unique" UNIQUE("secret")
);
--> statement-breakpoint
CREATE TABLE "user_quota_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quota_type" "quota_type" NOT NULL,
	"limit_type" "limit_type" NOT NULL,
	"limit_value" integer NOT NULL,
	"duration" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "user_quota_definitions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"upstream_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"headers" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "mcp_servers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"oauth_provider_type" "oauth_provider_type" NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "uq_oauth_credentials" UNIQUE("oauth_provider_type","account_id")
);
--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_oauth_credential_id_oauth_credentials_id_fk" FOREIGN KEY ("oauth_credential_id") REFERENCES "public"."oauth_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_models" ADD CONSTRAINT "provider_models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_alias_targets" ADD CONSTRAINT "model_alias_targets_alias_id_model_aliases_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."model_aliases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_providers_slug" ON "providers" USING btree ("slug");