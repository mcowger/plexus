ALTER TABLE "responses" ALTER COLUMN "store" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "input_items" text;