ALTER TABLE "custom_foods" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_foods" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "custom_foods" ADD CONSTRAINT "custom_foods_share_token_unique" UNIQUE("share_token");