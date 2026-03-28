CREATE TABLE "nutrition_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"product_name" text NOT NULL,
	"variant" text,
	"serving_size_g" numeric NOT NULL,
	"serving_size_label" text NOT NULL,
	"calories" integer NOT NULL,
	"protein_g" numeric NOT NULL,
	"carbs_g" numeric NOT NULL,
	"fat_g" numeric NOT NULL,
	"fiber_g" numeric NOT NULL,
	"sodium_mg" numeric NOT NULL,
	"saturated_fat_g" numeric,
	"trans_fat_g" numeric,
	"sugars_g" numeric,
	"extra_nutrients" jsonb,
	"source" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nutrition_labels" ADD CONSTRAINT "nutrition_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;