-- Change JSONB columns that may hold encrypted strings to TEXT.
-- JSONB columns cannot store opaque encrypted strings (enc:v1:...) because they
-- are not valid JSON. TEXT columns work for both plain JSON and encrypted values.
-- The USING clause safely converts existing JSONB data to its text representation.

ALTER TABLE "providers" ALTER COLUMN "headers" SET DATA TYPE text USING "headers"::text;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "extra_body" SET DATA TYPE text USING "extra_body"::text;--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "quota_checker_options" SET DATA TYPE text USING "quota_checker_options"::text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "headers" SET DATA TYPE text USING "headers"::text;
