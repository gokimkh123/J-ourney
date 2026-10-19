CREATE TABLE "place_relations" (
	"base_ym" text NOT NULL,
	"signgu_cd" text NOT NULL,
	"t_ats_cd" text NOT NULL,
	"t_ats_nm" text NOT NULL,
	"rlte_tats_cd" text NOT NULL,
	"rlte_tats_nm" text NOT NULL,
	"rlte_signgu_cd" text,
	"rlte_category" text,
	"rlte_category_mid" text,
	"rlte_category_sub" text,
	"rlte_rank" smallint,
	CONSTRAINT "place_relations_base_ym_t_ats_cd_rlte_tats_cd_pk" PRIMARY KEY("base_ym","t_ats_cd","rlte_tats_cd")
);
--> statement-breakpoint
CREATE TABLE "related_fetches" (
	"base_ym" text NOT NULL,
	"signgu_cd" text NOT NULL,
	"rows" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_fetches_base_ym_signgu_cd_pk" PRIMARY KEY("base_ym","signgu_cd")
);
--> statement-breakpoint
CREATE INDEX "place_relations_rlte_idx" ON "place_relations" USING btree ("rlte_signgu_cd","base_ym");