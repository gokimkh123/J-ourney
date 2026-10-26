CREATE TABLE "route_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"result" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
