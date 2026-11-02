CREATE TABLE "access_key_usage" (
	"label" text PRIMARY KEY NOT NULL,
	"used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- 이미 키로 시작한 회의 수를 옮겨 둠 (이 표가 생기기 전에는 회의 행으로 셈)
INSERT INTO "access_key_usage" ("label", "used") SELECT "access_label", count(*)::int FROM "meetings" WHERE "access_label" IS NOT NULL GROUP BY "access_label";
