CREATE TABLE "daily_calorie_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"calorie_goal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_calorie_goals_user_date_uniq" UNIQUE("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "daily_calorie_goals" ADD CONSTRAINT "daily_calorie_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;