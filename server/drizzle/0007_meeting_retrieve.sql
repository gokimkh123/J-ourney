CREATE TABLE "crowd_fetches" (
	"signgu_cd" text NOT NULL,
	"fetched_on" text NOT NULL,
	"rows" integer NOT NULL,
	CONSTRAINT "crowd_fetches_signgu_cd_fetched_on_pk" PRIMARY KEY("signgu_cd","fetched_on")
);
--> statement-breakpoint
CREATE TABLE "crowd_forecasts" (
	"signgu_cd" text NOT NULL,
	"base_ymd" text NOT NULL,
	"spot_name" text NOT NULL,
	"rate" double precision NOT NULL,
	CONSTRAINT "crowd_forecasts_signgu_cd_base_ymd_spot_name_pk" PRIMARY KEY("signgu_cd","base_ymd","spot_name")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"region_code" text NOT NULL,
	"region_name" text NOT NULL,
	"district_code" text NOT NULL,
	"district_name" text NOT NULL,
	CONSTRAINT "regions_region_code_district_code_pk" PRIMARY KEY("region_code","district_code")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "conditions" jsonb;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "region_code" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "district_codes" jsonb;