CREATE TABLE "llm_ip_usage" (
	"day" text NOT NULL,
	"ip_hash" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_ip_usage_day_ip_hash_pk" PRIMARY KEY("day","ip_hash")
);
