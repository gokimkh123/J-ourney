CREATE TABLE "meeting_reviews" (
	"meeting_id" text NOT NULL,
	"member_id" text NOT NULL,
	"choices" jsonb NOT NULL,
	"submitted_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_reviews_meeting_id_member_id_pk" PRIMARY KEY("meeting_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "ip_key" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_reviews" ADD CONSTRAINT "meeting_reviews_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_reviews" ADD CONSTRAINT "meeting_reviews_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;