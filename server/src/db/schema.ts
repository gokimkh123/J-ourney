import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';
import type { Chip, MustKeepRule, PersonaAnswers, PersonaProfile, TraitResult } from '../persona/types.js';
import type { ReviewChoice, StoredReview, TripConditions } from '../meeting/types.js';
import type { FinalPlan } from '../meeting/finalize.js';
import type { PlanProposal, PlanSets, PlanStates } from '../meeting/schedule.js';

/** 참가 인원 상한 (방장 포함). 4명 초과 참가는 추후 유료 기능으로 둠 */
export const MAX_MEMBERS = 4;
/** 회의를 시작할 수 있는 최소 인원 (방장 포함). 혼자서는 회의·투표가 성립하지 않음 */
export const MIN_MEMBERS = 2;

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
 * LLM 녹화: 실제로 부른 LLM의 답을 요청 지문(sha256)으로 저장함 (LLM_REPLAY에서 같은 요청은 부르지 않고 이 답을 씀)
 * 요청 원문은 저장하지 않음 (크기, 성향 원문은 personas에 이미 있음). 시험을 다시 돌리는 용도라 지워도 회의·카드 동작에는 지장 없음
 */
export const llmRecords = pgTable('llm_records', {
  key: text('key').primaryKey(),
  /** 용도 (schemaName: persona_card · meeting_pick · place_names · meeting_react) */
  purpose: text('purpose').notNull(),
  /** 부른 LLM 설정 이름 (공급자:모델 → 예비 모델) */
  model: text('model').notNull(),
  attempt: smallint('attempt').notNull(),
  response: jsonb('response').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 장소 — TourAPI(국문 관광정보) 장소 정보 (목록 값과 상세: 소개글·영업시간)
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

/** 장소 자료 갱신 상태 (name 'list' = 목록을 마지막으로 다시 맞춘 시각) */
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

/**
 * 길찾기 결과 보관 (카카오 대중교통·도보·자동차). 같은 구간은 ROUTE.cacheDays일 동안 다시 써 무료 한도를 아낌 (카카오 정책상 오래 보관하지 않음)
 * key = 방식 + 출발·도착 좌표(소수 넷째 자리, 약 11m). result가 null이면 카카오가 '경로 없음'으로 답한 구간 (다시 묻지 않음)
 */
export const routeCache = pgTable('route_cache', {
  key: text('key').primaryKey(),
  mode: text('mode').notNull(),
  result: jsonb('result'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 장소 분류 이름표 (TourAPI 신분류 3단계, 예: EX050100 = 체험관광 > 웰니스관광 > 온천 / 사우나 / 스파) */
export const categories = pgTable('categories', {
  code: text('code').primaryKey(),
  name1: text('name1').notNull(),
  name2: text('name2').notNull(),
  name3: text('name3').notNull(),
});

/**
 * 회의 실행 (명세서 mtg_): 여행마다 실행 횟수 상한·진행 중 잠금·이 실행의 LLM 호출 수를 둠
 * 단계별 상태는 LangGraph 체크포인트(langgraph 스키마)에 thread_id = 회의 id로 저장됨
 * status: running 진행 중 · reviewing 5단계 사람 확인 기다림 (그래프가 멈춰 있음) · done 끝 · failed 실패
 */
export const meetings = pgTable(
  'meetings',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    runNo: integer('run_no').notNull(),
    status: text('status', { enum: ['running', 'reviewing', 'done', 'failed'] }).notNull(),
    llmCalls: integer('llm_calls').notNull().default(0),
    /** 접근 키로 시작한 회의면 그 키 이름 (키마다 짤 수 있는 여행 횟수를 셈). 서버 안에서 시작했거나 키가 없는 서버면 null */
    accessLabel: text('access_label'),
    /** 5단계 사람 확인 요청과 마감 결과 */
    review: jsonb('review').$type<StoredReview>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [unique('meetings_trip_run').on(t.tripId, t.runNo)],
);

/** 5단계 사람 확인 응답: 구성원마다 1행, 다시 내면 덮어씀. submittedBy는 낸 사람 (시연 모드에서 방장이 대신 내면 방장) */
export const meetingReviews = pgTable(
  'meeting_reviews',
  {
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    choices: jsonb('choices').$type<ReviewChoice[]>().notNull(),
    submittedBy: text('submitted_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.memberId] })],
);

/** 회의 이벤트 기록 (명세서 WebSocket 봉투 {type, tripId, seq, at, data}): seq는 여행마다 1부터, 다시 접속하면 afterSeq 뒤부터 보냄 */
export const meetingEvents = pgTable(
  'meeting_events',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.seq] })],
);

/**
 * 13–15단계 (명세서 4.5, v2.3): 회의가 끝나면 여행마다 1행을 엶. 사람이 A·B 중 고르고(14) 고친 안을 모두 찬성해 확정함(15)
 * 같은 여행에서 회의를 다시 하면 새 회의 것으로 바꿈 (시험 경로)
 * status: choosing A·B 고르는 중 · revising 고른 안을 고치는 중 · voting 확정 투표 중 · confirmed 확정
 */
export const tripPlans = pgTable('trip_plans', {
  tripId: text('trip_id')
    .primaryKey()
    .references(() => trips.id, { onDelete: 'cascade' }),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['choosing', 'revising', 'voting', 'confirmed'] }).notNull(),
  /** 13단계 결과: A·B 두 안(그때의 마지막 버전, route 포함)과 이름·설명·만족도·양보 */
  candidates: jsonb('candidates').$type<(FinalPlan & { plan: PlanProposal })[]>().notNull(),
  /** 두 안의 재료 (고른 안을 고칠 때 이어서 씀) */
  states: jsonb('states').$type<PlanStates>().notNull(),
  /** 14단계: 사람마다 고른 안 (memberId → planId)과 정해진 안 */
  choices: jsonb('choices').$type<Record<string, string>>().notNull().default({}),
  chosen: jsonb('chosen').$type<{ planId: string; label: 'A' | 'B'; by: 'all' | 'host'; tie: boolean; votes: { A: number; B: number } }>(),
  /** 고른 안의 지금 버전과 재료, 사람이 고친 기록 */
  plan: jsonb('plan').$type<PlanProposal>(),
  planState: jsonb('plan_state').$type<PlanSets>(),
  edits: jsonb('edits').$type<{ version: number; by: string; at: string; changes: string[] }[]>().notNull().default([]),
  /** 15단계: 확정 투표 (memberId → approve·reject)와 투표를 시작한 버전 */
  votes: jsonb('votes').$type<Record<string, 'approve' | 'reject'>>().notNull().default({}),
  voteVersion: integer('vote_version'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});

