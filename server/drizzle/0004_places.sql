CREATE TABLE "places" (
	"content_id" text PRIMARY KEY NOT NULL,
	"content_type_id" integer NOT NULL,
	"title" text NOT NULL,
	"addr" text,
	"region_code" text,
	"district_code" text,
	"lcls1" text,
	"lcls2" text,
	"lcls3" text,
	"lat" double precision,
	"lng" double precision,
	"image" text,
	"image_copyright" text,
	"tel" text,
	"visible" boolean NOT NULL,
	"source_modified" text,
	"list_raw" jsonb NOT NULL,
	"list_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overview" text,
	"detail_raw" jsonb,
	"intro_raw" jsonb,
	"detail_source_modified" text,
	"detail_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tour_api_usage" (
	"day" text NOT NULL,
	"operation" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tour_api_usage_day_operation_pk" PRIMARY KEY("day","operation")
);
--> statement-breakpoint
CREATE INDEX "places_region_idx" ON "places" USING btree ("region_code","district_code");--> statement-breakpoint
CREATE INDEX "places_type_idx" ON "places" USING btree ("content_type_id");