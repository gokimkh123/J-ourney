CREATE TABLE "meeting_events" (
	"trip_id" text NOT NULL,
	"seq" integer NOT NULL,
	"meeting_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_events_trip_id_seq_pk" PRIMARY KEY("trip_id","seq")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"run_no" integer NOT NULL,
	"status" text NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "meetings_trip_run" UNIQUE("trip_id","run_no")
);
--> statement-breakpoint
ALTER TABLE "meeting_events" ADD CONSTRAINT "meeting_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_events" ADD CONSTRAINT "meeting_events_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;