ALTER TABLE "provider_cooldowns" DROP CONSTRAINT "provider_cooldowns_provider_model_account_id_pk";--> statement-breakpoint
ALTER TABLE "provider_cooldowns" ADD CONSTRAINT "provider_cooldowns_provider_model_pk" PRIMARY KEY("provider","model");--> statement-breakpoint
ALTER TABLE "provider_cooldowns" DROP COLUMN "account_id";