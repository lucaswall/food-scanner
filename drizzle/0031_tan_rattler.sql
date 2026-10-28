CREATE TABLE "waist_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"zone_offset" varchar(6),
	"value_cm" numeric NOT NULL,
	CONSTRAINT "waist_readings_user_measured_at_uniq" UNIQUE("user_id","measured_at")
);
--> statement-breakpoint
ALTER TABLE "waist_readings" ADD CONSTRAINT "waist_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;