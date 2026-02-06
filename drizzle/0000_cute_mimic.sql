CREATE TABLE "fitbit_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"fitbit_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitbit_tokens_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "food_logs" (
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
	"confidence" text NOT NULL,
	"notes" text,
	"meal_type_id" integer NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"fitbit_food_id" integer,
	"fitbit_log_id" integer,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
