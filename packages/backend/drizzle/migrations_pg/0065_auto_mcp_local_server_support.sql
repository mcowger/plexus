ALTER TABLE "mcp_servers" ADD COLUMN "mode" text DEFAULT 'remote_http' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "launcher" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "package_name" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "args" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "env" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "port" bigint;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "startup_timeout_ms" bigint;