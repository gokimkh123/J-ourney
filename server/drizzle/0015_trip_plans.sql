CREATE TABLE "trip_plans" (
	"trip_id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"status" text NOT NULL,
	"candidates" jsonb NOT NULL,
	"states" jsonb NOT NULL,
	"choices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chosen" jsonb,
	"plan" jsonb,
	"plan_state" jsonb,
	"edits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"votes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vote_version" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;