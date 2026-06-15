ALTER TABLE "providers" ADD COLUMN "stall_ttfb_ms" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stall_ttfb_bytes" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stall_min_bps" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stall_window_ms" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stall_grace_period_ms" integer;