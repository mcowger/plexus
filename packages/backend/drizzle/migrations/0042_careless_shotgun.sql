ALTER TABLE `providers` ADD `stall_ttfb_ms` integer;--> statement-breakpoint
ALTER TABLE `providers` ADD `stall_ttfb_bytes` integer;--> statement-breakpoint
ALTER TABLE `providers` ADD `stall_min_bps` integer;--> statement-breakpoint
ALTER TABLE `providers` ADD `stall_window_ms` integer;--> statement-breakpoint
ALTER TABLE `providers` ADD `stall_grace_period_ms` integer;