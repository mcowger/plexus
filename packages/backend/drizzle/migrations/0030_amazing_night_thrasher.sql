ALTER TABLE `providers` ADD `gpu_profile` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `gpu_ram_gb` real;--> statement-breakpoint
ALTER TABLE `providers` ADD `gpu_bandwidth_tb_s` real;--> statement-breakpoint
ALTER TABLE `providers` ADD `gpu_flops_tflop` real;--> statement-breakpoint
ALTER TABLE `providers` ADD `gpu_power_draw_watts` integer;--> statement-breakpoint
ALTER TABLE `model_aliases` ADD `model_architecture` text;