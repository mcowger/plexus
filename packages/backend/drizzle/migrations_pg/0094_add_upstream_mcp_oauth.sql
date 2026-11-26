CREATE TABLE "mcp_upstream_oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"revision" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_upstream_oauth_grants" (
	"server_id" integer PRIMARY KEY NOT NULL,
	"revision" text NOT NULL,
	"version" text NOT NULL,
	"payload" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "upstream_oauth" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "upstream_oauth_revision" text;--> statement-breakpoint
ALTER TABLE "mcp_upstream_oauth_grants" ADD CONSTRAINT "mcp_upstream_oauth_grants_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;