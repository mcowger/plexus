CREATE TABLE "classifier_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"tier" text NOT NULL,
	"score" real NOT NULL,
	"confidence" real NOT NULL,
	"method" text NOT NULL,
	"reasoning" text NOT NULL,
	"signals" text NOT NULL,
	"agentic_score" real NOT NULL,
	"has_structured_output" boolean NOT NULL,
	"resolved_alias" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_classifier_log_request_id" ON "classifier_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_classifier_log_created_at" ON "classifier_log" USING btree ("created_at");