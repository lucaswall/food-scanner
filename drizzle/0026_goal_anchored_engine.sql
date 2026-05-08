ALTER TABLE "users" DROP CONSTRAINT "users_macro_profile_chk";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "activity_level" text;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "goal_weight_kg" numeric;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "goal_rate_kg_per_week" numeric;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "tdee" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "deficit_kcal" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activity_level" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "goal_weight_kg" numeric;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "goal_rate_kg_per_week" numeric;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" DROP COLUMN "calories_out";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" DROP COLUMN "activity_kcal";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" DROP COLUMN "goal_type";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" DROP COLUMN "bmi_tier";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" DROP COLUMN "profile_version";--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" DROP COLUMN "tdee_source";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "macro_profile";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "macro_profile_version";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_activity_level_chk" CHECK ("users"."activity_level" IS NULL OR "users"."activity_level" IN ('sedentary','light','moderate','very_active','extra_active'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_goal_rate_chk" CHECK ("users"."goal_rate_kg_per_week" IS NULL OR "users"."goal_rate_kg_per_week" >= 0);--> statement-breakpoint
DELETE FROM "daily_calorie_goals" WHERE "date" >= CURRENT_DATE;