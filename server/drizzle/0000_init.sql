CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"nickname" text NOT NULL,
	"seat" smallint NOT NULL,
	"is_host" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "members_trip_seat_unique" UNIQUE("trip_id","seat"),
	CONSTRAINT "members_seat_range" CHECK ("members"."seat" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"invite_code" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"demo_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;