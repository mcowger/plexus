ALTER TABLE "request_usage" ADD COLUMN "vision_fallthrough_model" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "gpu_profile" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "gpu_ram_gb" real;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "gpu_bandwidth_tb_s" real;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "gpu_flops_tflop" real;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "gpu_power_draw_watts" integer;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "model_architecture" jsonb;