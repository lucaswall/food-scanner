CREATE TABLE "health_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"health_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "fitbit_credentials" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fitbit_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "fitbit_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "fitbit_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "custom_foods" ALTER COLUMN "unit_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "food_log_entries" ALTER COLUMN "unit_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD COLUMN "health_log_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weight_goal_type" text;--> statement-breakpoint
ALTER TABLE "health_tokens" ADD CONSTRAINT "health_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_foods_user_idx" ON "custom_foods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "food_log_entries_user_date_idx" ON "food_log_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "food_log_entries_custom_food_idx" ON "food_log_entries" USING btree ("custom_food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_log_entries_user_health_log_uniq" ON "food_log_entries" USING btree ("user_id","health_log_id") WHERE health_log_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_foods" DROP COLUMN "fitbit_food_id";--> statement-breakpoint
ALTER TABLE "food_log_entries" DROP COLUMN "fitbit_log_id";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD CONSTRAINT "daily_calorie_goals_activity_level_chk" CHECK ("daily_calorie_goals"."activity_level" IS NULL OR "daily_calorie_goals"."activity_level" IN ('sedentary','light','moderate','very_active','extra_active'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_weight_goal_type_chk" CHECK ("users"."weight_goal_type" IS NULL OR "users"."weight_goal_type" IN ('LOSE','MAINTAIN','GAIN'));