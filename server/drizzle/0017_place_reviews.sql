CREATE TABLE "place_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"member_id" text,
	"trip_id" text,
	"nickname" text NOT NULL,
	"rating" smallint NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_reviews_place_member" UNIQUE("place_id","member_id"),
	CONSTRAINT "place_reviews_rating" CHECK ("place_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "place_reviews" ADD CONSTRAINT "place_reviews_place_id_places_content_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("content_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_reviews" ADD CONSTRAINT "place_reviews_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_reviews" ADD CONSTRAINT "place_reviews_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_reviews_place_idx" ON "place_reviews" USING btree ("place_id");