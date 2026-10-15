import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';
import type { Chip, MustKeepRule, PersonaAnswers, PersonaProfile, TraitResult } from '../persona/types.js';
import type { TripConditions } from '../meeting/types.js';

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
  /** 회의 조건 (명세서 4.4). 저장 전에는 null */
  conditions: jsonb('conditions').$type<TripConditions>(),
  /** 목적지를 법정동 코드로 바꾼 값 (시·도 코드, 시·군·구 코드 목록. 목록이 비면 시·도 전체) */
  regionCode: text('region_code'),
  districtCodes: jsonb('district_codes').$type<string[]>(),
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

/**
 * 장소 — TourAPI(국문 관광정보) 장소를 영구 저장함. 목록 값은 매일 동기화하고, 상세(소개글·영업시간)는 필요한 장소만 채움
 * 비표출(폐업·삭제 등)된 장소는 지우지 않고 visible=false로 둠. 출처 표시: ⓒ한국관광공사
 */
export const places = pgTable(
  'places',
  {
    contentId: text('content_id').primaryKey(),
    contentTypeId: integer('content_type_id').notNull(),
    title: text('title').notNull(),
    addr: text('addr'),
    /** 법정동 시·도 코드(예: 26 부산)와 시·군·구 코드 */
    regionCode: text('region_code'),
    districtCode: text('district_code'),
    /** 신분류 코드 (예: NA 자연, FD 음식) */
    lcls1: text('lcls1'),
    lcls2: text('lcls2'),
    lcls3: text('lcls3'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    image: text('image'),
    /** 사진 공공누리 유형 (Type1 출처 표시, Type3 출처 표시·변경 금지) */
    imageCopyright: text('image_copyright'),
    tel: text('tel'),
    visible: boolean('visible').notNull(),
    /** 원본 수정 시각 (YYYYMMDDhhmmss) — 상세를 받은 뒤 바뀌었는지 비교함 */
    sourceModified: text('source_modified'),
    listRaw: jsonb('list_raw').$type<Record<string, string>>().notNull(),
    listSyncedAt: timestamp('list_synced_at', { withTimezone: true }).notNull().defaultNow(),
    overview: text('overview'),
    detailRaw: jsonb('detail_raw').$type<Record<string, string>>(),
    introRaw: jsonb('intro_raw').$type<Record<string, string>>(),
    detailSourceModified: text('detail_source_modified'),
    detailSyncedAt: timestamp('detail_synced_at', { withTimezone: true }),
  },
  (t) => [index('places_region_idx').on(t.regionCode, t.districtCode), index('places_type_idx').on(t.contentTypeId)],
);

/** 날짜·기능별 TourAPI 호출 수 (한국 날짜 기준, 하루 상한 확인용) */
export const tourApiUsage = pgTable(
  'tour_api_usage',
  {
    day: text('day').notNull(),
    operation: text('operation').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.operation] })],
);

/** 장소 수집 작업 상태 (name 'list' = 전국 목록을 마지막으로 끝까지 다시 맞춘 시각, 한 달 단위 갱신 판단용) */
export const tourSyncState = pgTable('tour_sync_state', {
  name: text('name').primaryKey(),
  doneAt: timestamp('done_at', { withTimezone: true }).notNull(),
});

/**
 * 연관 관광지 (한국관광공사 TarRlteTarService1, 티맵 내비게이션 기반 월별 자료)
 * 시·군·구 주요 관광지(tAts)마다 함께 찾은 장소(rlte)를 분류(관광지·음식·숙박)별 순위 1–50으로 저장함 (인기도·함께 가는 장소 계산용)
 */
export const placeRelations = pgTable(
  'place_relations',
  {
    baseYm: text('base_ym').notNull(),
    signguCd: text('signgu_cd').notNull(),
    tAtsCd: text('t_ats_cd').notNull(),
    tAtsNm: text('t_ats_nm').notNull(),
    rlteTatsCd: text('rlte_tats_cd').notNull(),
    rlteTatsNm: text('rlte_tats_nm').notNull(),
    rlteSignguCd: text('rlte_signgu_cd'),
    rlteCategory: text('rlte_category'),
    rlteCategoryMid: text('rlte_category_mid'),
    rlteCategorySub: text('rlte_category_sub'),
    rlteRank: smallint('rlte_rank'),
  },
  (t) => [primaryKey({ columns: [t.baseYm, t.tAtsCd, t.rlteTatsCd] }), index('place_relations_rlte_idx').on(t.rlteSignguCd, t.baseYm)],
);

/** 연관 관광지를 받은 (월, 시·군·구). 자료가 없는 곳(0건)도 남겨 다시 부르지 않음 */
export const relatedFetches = pgTable(
  'related_fetches',
  {
    baseYm: text('base_ym').notNull(),
    signguCd: text('signgu_cd').notNull(),
    rows: integer('rows').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.baseYm, t.signguCd] })],
);

/** 행정 지역 (TourAPI 법정동 코드: 시·도 + 시·군·구). 회의 조건의 목적지를 코드로 바꿀 때 씀 */
export const regions = pgTable(
  'regions',
  {
    regionCode: text('region_code').notNull(),
    regionName: text('region_name').notNull(),
    districtCode: text('district_code').notNull(),
    districtName: text('district_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.regionCode, t.districtCode] })],
);

/** 관광지 집중률 예측 (한국관광공사, 구·군별 30일 예측). 받은 날의 예측만 쓰고 지난 날짜는 지움 */
export const crowdForecasts = pgTable(
  'crowd_forecasts',
  {
    signguCd: text('signgu_cd').notNull(),
    baseYmd: text('base_ymd').notNull(),
    spotName: text('spot_name').notNull(),
    rate: doublePrecision('rate').notNull(),
  },
  (t) => [primaryKey({ columns: [t.signguCd, t.baseYmd, t.spotName] })],
);

/** 집중률을 받은 (구·군, 받은 날). 0건이어도 남겨 같은 날 다시 부르지 않음 */
export const crowdFetches = pgTable(
  'crowd_fetches',
  {
    signguCd: text('signgu_cd').notNull(),
    fetchedOn: text('fetched_on').notNull(),
    rows: integer('rows').notNull(),
  },
  (t) => [primaryKey({ columns: [t.signguCd, t.fetchedOn] })],
);

/** 장소 분류 이름표 (TourAPI 신분류 3단계, 예: EX050100 = 체험관광 > 웰니스관광 > 온천 / 사우나 / 스파) */
export const categories = pgTable('categories', {
  code: text('code').primaryKey(),
  name1: text('name1').notNull(),
  name2: text('name2').notNull(),
  name3: text('name3').notNull(),
});
