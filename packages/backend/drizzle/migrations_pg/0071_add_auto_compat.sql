ALTER TABLE "providers" ADD COLUMN "auto_compat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_models" ADD COLUMN "auto_compat" boolean;