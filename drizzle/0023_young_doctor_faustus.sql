ALTER TABLE "daily_calorie_goals" ADD COLUMN "goal_type" text;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "bmi_tier" text;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "profile_version" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "weight_logged_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "macro_profile_version" integer DEFAULT 1 NOT NULL;