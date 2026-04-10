CREATE TABLE "hydration_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"zone_offset" varchar(6),
	"volume_ml" integer NOT NULL,
	CONSTRAINT "hydration_readings_user_measured_at_uniq" UNIQUE("user_id","measured_at")
);
--> statement-breakpoint
ALTER TABLE "hydration_readings" ADD CONSTRAINT "hydration_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;