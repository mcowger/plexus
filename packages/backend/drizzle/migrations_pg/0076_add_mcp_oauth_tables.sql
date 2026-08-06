CREATE TABLE "mcp_oauth_authorization_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"scope" text,
	"key_name" text NOT NULL,
	"api_key_secret_hash" text,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "mcp_oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text,
	"redirect_uris" text NOT NULL,
	"grant_types" text,
	"response_types" text,
	"scope" text,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "mcp_oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"access_token_hash" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"refresh_token" text NOT NULL,
	"client_id" text NOT NULL,
	"key_name" text NOT NULL,
	"api_key_secret_hash" text,
	"resource" text NOT NULL,
	"scope" text,
	"access_token_expires_at" bigint NOT NULL,
	"refresh_token_expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "mcp_oauth_tokens_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "mcp_oauth_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE INDEX "idx_mcp_oauth_authorization_codes_client_id" ON "mcp_oauth_authorization_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_oauth_authorization_codes_expires_at" ON "mcp_oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_mcp_oauth_tokens_client_id" ON "mcp_oauth_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_oauth_tokens_key_name" ON "mcp_oauth_tokens" USING btree ("key_name");--> statement-breakpoint
CREATE INDEX "idx_mcp_oauth_tokens_access_token_expires_at" ON "mcp_oauth_tokens" USING btree ("access_token_expires_at");