CREATE TABLE "lumen_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"day_type" text NOT NULL,
	"protein_goal" integer NOT NULL,
	"carbs_goal" integer NOT NULL,
	"fat_goal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lumen_goals_user_date_uniq" UNIQUE("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "lumen_goals" ADD CONSTRAINT "lumen_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;