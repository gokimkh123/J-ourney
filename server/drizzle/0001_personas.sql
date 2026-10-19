CREATE TABLE "llm_usage" (
	"day" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"member_id" text PRIMARY KEY NOT NULL,
	"answers" jsonb NOT NULL,
	"traits" jsonb NOT NULL,
	"chips" jsonb NOT NULL,
	"title" text NOT NULL,
	"catchphrase" text NOT NULL,
	"tmi" text NOT NULL,
	"must_keep" jsonb NOT NULL,
	"wishes" jsonb NOT NULL,
	"profile" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;