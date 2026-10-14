import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';

/** 참가 인원 상한 (방장 포함). 4명 초과 참가는 추후 유료 기능으로 둠 */
export const MAX_MEMBERS = 4;

/** 여행 (명세서 4.2) — status: preparing 페르소나 준비, meeting 회의 중, voting 확정 투표 중, confirmed 확정 */
export const trips = pgTable('trips', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  status: text('status', { enum: ['preparing', 'meeting', 'voting', 'confirmed'] })
    .notNull()
    .default('preparing'),
  demoMode: boolean('demo_mode').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 구성원 — seat는 참여 순서(1–4)이며 색상은 seat로 정함. 토큰은 원문 대신 SHA-256 값만 저장함 */
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    seat: smallint('seat').notNull(),
    isHost: boolean('is_host').notNull().default(false),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('members_trip_seat_unique').on(t.tripId, t.seat),
    check('members_seat_range', sql`${t.seat} between 1 and ${sql.raw(String(MAX_MEMBERS))}`),
  ],
);
