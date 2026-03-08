CREATE TABLE "provider_rate_limits" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"current_budget" bigint NOT NULL,
	"last_refill_at" bigint NOT NULL,
	"queue_depth" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "provider_rate_limits_provider_model_pk" PRIMARY KEY("provider","model")
);
--> statement-breakpoint
CREATE INDEX "idx_rate_limits_last_refill" ON "provider_rate_limits" USING btree ("last_refill_at");