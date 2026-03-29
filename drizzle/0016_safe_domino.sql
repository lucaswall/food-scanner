CREATE TABLE "blood_pressure_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"zone_offset" varchar(6),
	"systolic" integer NOT NULL,
	"diastolic" integer NOT NULL,
	"body_position" text,
	"measurement_location" text,
	CONSTRAINT "blood_pressure_readings_user_measured_at_uniq" UNIQUE("user_id","measured_at")
);
--> statement-breakpoint
CREATE TABLE "glucose_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"zone_offset" varchar(6),
	"value_mg_dl" numeric NOT NULL,
	"relation_to_meal" text,
	"meal_type" text,
	"specimen_source" text,
	CONSTRAINT "glucose_readings_user_measured_at_uniq" UNIQUE("user_id","measured_at")
);
--> statement-breakpoint
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glucose_readings" ADD CONSTRAINT "glucose_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;