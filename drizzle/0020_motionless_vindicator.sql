ALTER TABLE "daily_calorie_goals" ADD COLUMN "protein_goal" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "carbs_goal" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "fat_goal" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "weight_kg" numeric;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "calories_out" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "rmr" integer;--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD COLUMN "activity_kcal" integer;--> statement-breakpoint
ALTER TABLE "fitbit_tokens" ADD COLUMN "scope" text;