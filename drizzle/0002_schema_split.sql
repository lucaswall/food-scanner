CREATE TABLE "custom_foods" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"food_name" text NOT NULL,
	"amount" numeric NOT NULL,
	"unit_id" integer NOT NULL,
	"calories" integer NOT NULL,
	"protein_g" numeric NOT NULL,
	"carbs_g" numeric NOT NULL,
	"fat_g" numeric NOT NULL,
	"fiber_g" numeric NOT NULL,
	"sodium_mg" numeric NOT NULL,
	"fitbit_food_id" bigint,
	"confidence" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_log_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"custom_food_id" integer NOT NULL,
	"fitbit_log_id" bigint,
	"meal_type_id" integer NOT NULL,
	"amount" numeric NOT NULL,
	"unit_id" integer NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_custom_food_id_custom_foods_id_fk" FOREIGN KEY ("custom_food_id") REFERENCES "public"."custom_foods"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP TABLE "food_logs" CASCADE;
