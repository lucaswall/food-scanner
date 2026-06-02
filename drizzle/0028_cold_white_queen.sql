ALTER TABLE "users" ADD COLUMN "sex" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sex_chk" CHECK ("users"."sex" IS NULL OR "users"."sex" IN ('MALE','FEMALE'));