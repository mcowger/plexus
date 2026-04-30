ALTER TABLE "meter_snapshots" ALTER COLUMN "success" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "meter_snapshots" ALTER COLUMN "success" SET DATA TYPE boolean USING (success::integer::boolean);--> statement-breakpoint
ALTER TABLE "meter_snapshots" ALTER COLUMN "success" SET DEFAULT true;