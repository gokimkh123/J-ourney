import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';
import type { Chip, MustKeepRule, PersonaAnswers, PersonaProfile, TraitResult } from '../persona/types.js';

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
    /** AI(LLM)로 페르소나 카드를 만든 횟수 (구성원당 상한 확인용) */
    llmCards: integer('llm_cards').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('members_trip_seat_unique').on(t.tripId, t.seat),
    check('members_seat_range', sql`${t.seat} between 1 and ${sql.raw(String(MAX_MEMBERS))}`),
  ],
);

/** 페르소나 — 구성원 1명당 1행. 화면용 카드 값과 회의용 숨은 값(profile)을 함께 저장함 */
export const personas = pgTable('personas', {
  memberId: text('member_id')
    .primaryKey()
    .references(() => members.id, { onDelete: 'cascade' }),
  answers: jsonb('answers').$type<PersonaAnswers>().notNull(),
  traits: jsonb('traits').$type<TraitResult[]>().notNull(),
  chips: jsonb('chips').$type<Chip[]>().notNull(),
  title: text('title').notNull(),
  catchphrase: text('catchphrase').notNull(),
  tmi: text('tmi').notNull(),
  mustKeep: jsonb('must_keep').$type<MustKeepRule[]>().notNull(),
  wishes: jsonb('wishes').$type<string[]>().notNull(),
  profile: jsonb('profile').$type<PersonaProfile>().notNull(),
  source: text('source', { enum: ['llm', 'rule'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 날짜별 LLM 호출 수 (한국 날짜 기준, 하루 상한 확인용) */
export const llmUsage = pgTable('llm_usage', {
  day: text('day').primaryKey(),
  count: integer('count').notNull().default(0),
});

/** 터널로 들어온 IP별 하루 AI(LLM) 작업 횟수 (팀원 개발·외부 요청의 키 사용량 제한용). IP는 원문 대신 HMAC 값만 저장함 */
export const llmIpUsage = pgTable(
  'llm_ip_usage',
  {
    day: text('day').notNull(),
    ipHash: text('ip_hash').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.ipHash] })],
);
