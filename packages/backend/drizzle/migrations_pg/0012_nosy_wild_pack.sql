CREATE TABLE "quota_state" (
	"key_name" text PRIMARY KEY NOT NULL,
	"quota_name" text NOT NULL,
	"current_usage" real DEFAULT 0 NOT NULL,
	"last_updated" bigint NOT NULL,
	"window_start" bigint
);
