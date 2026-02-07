ALTER TABLE "fitbit_tokens" DROP CONSTRAINT "fitbit_tokens_email_unique";--> statement-breakpoint
ALTER TABLE "custom_foods" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "fitbit_tokens" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "food_log_entries" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "email";