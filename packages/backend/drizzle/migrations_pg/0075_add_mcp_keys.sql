CREATE TABLE "mcp_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"mcp_server_id" integer NOT NULL,
	"key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cooldown_until" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "rate_limit_cooldown_ms" integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "quota_cooldown_ms" integer DEFAULT 86400000 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "auth_scheme" text;--> statement-breakpoint
ALTER TABLE "mcp_keys" ADD CONSTRAINT "mcp_keys_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;