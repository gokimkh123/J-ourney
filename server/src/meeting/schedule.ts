import { and, eq, inArray, like, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, places } from '../db/schema.js';
import type { MustKeepRule } from '../persona/types.js';
import { type OpenHours, closedOn, hoursOn } from './hours.js';
import { REACT, overlapMinutes, reactionOf, reactionScore } from './react.js';
import { type Candidate, HOURS_KEYS, type Mark, type MemberInput, REST_KEYS, RETRIEVE, type RetrieveResult, intro, isBusiness } from './retrieve.js';
import type { CarLeg, RouteClient, TransitLeg, WalkLeg } from './route.js';
import { type RulePlace, dislikeMatches, dislikeText, isAreaRule, isDietAvoid, isLegacyRule, isNameRule, likeMatches, likeText, ruleMatcher } from './rules.js';
import { placeIdOf } from './runs.js';
import { type Point, TRAVEL, centerOf, distanceKm } from './travel.js';
import type { Board, MoveMode, ReviewDecision } from './types.js';
import { DAY_MS } from '../lib/time.js';

/**
 * 6단계 동선 짜기 규칙 값 (모두 여기서만 바꿈). 10/23 사용자 결정: 머무는 시간·시각표는 근거가 없어 넣지 않고, 경로 + 가는 길(대중교통·자차·택시) + 맛집 + 낭비 없는 순서만 줌
 * perDayRange: 하루 관광지 수 = 참여한 사람(2–4명)마다 원하는 장소 수(성향 속도 범위의 가운데)의 평균을 반올림해 이 범위로 (10/23 사용자 결정 '평균')
 * popularityWeight: 인기도 100 = 반응 점수 2점 · poolPenalty: 보드에 없던 곳(2단계 후보·DB에서 보충한 식당) 감점
 * sameKindPenalty: 한 안에 같은 소분류(분류 코드 앞 6자리)가 이미 있으면 감점 (같은 종류 쏠림, 10/23 방안 가 시험에서 남은 문제)
 * distPenaltyPerKm: 날마다 넣을 곳을 고를 때 묶음 가운데에서 1km당 감점 · anchors: 빈 날의 가운데로 놓아 볼 점수 상위 후보 수
 * mealPrioPerKm: 식당 고르기에서 점수 1점 = 0.3km 덜 돌아가는 것과 같음 (식당 후보가 많아 이 둘은 직선거리로 고르고, 고른 뒤 구간은 카카오 길찾기)
 * meals: 끼니 시간대 (통상, 10/23 사용자 확인). 하루 시작이 점심 끝보다 이르면 점심, 하루 끝이 저녁 시작보다 늦으면 저녁
 * mealCodes: 끼니로 가는 음식점의 공식 분류 (한식·외국식·간이음식, 제과 뺌). 카페·찻집·주점·제과는 보드에 오르면 관광지처럼 둠
 * night: 야경 좋아요가 있는 사람이 있으면, 해가 지평선 아래 12°가 되는 때(항해박명 끝, 하늘이 어두워 불빛이 보임)에 여는 전망대(공식 분류)를 그날 마지막에 둠
 *   (10/23 정할 것 ②: 18시에 닫는 전망대는 야경으로 두지 않음). 시작 시각이 모두 저녁 시작 뒤인 곳(밤 행사·야시장)도 저녁 뒤에 둠
 * heavyMoveShare: 하루 이동 시간(카카오)이 하루 시간(시작~끝)의 이 비율을 넘으면 '이동 많음' (Dijst·Vidakovic 2000, 이동 시간 비율)
 * parallel: 카카오 길찾기를 한 번에 몇 개씩 부를지 (구간 가는 길은 그 절반씩, 한 구간에 대중교통·자동차를 함께 물으므로) · fareRoundWon: 택시 1인 요금(한 대 요금 ÷ 인원)을 이 단위로 반올림
 * orderAllMax: 하루 관광지가 이 수 이하면 모든 순서를 따짐(8곳 = 40,320가지), 넘으면 가까운 곳부터 잇고 두 구간 바꾸기(2-opt)로 다듬음
 *   (10/28 점검: 꼭 지킬 곳이 많은 당일 여행은 10곳을 넘을 수 있고, 10곳의 모든 순서는 363만 가지라 서버가 멈춤)
 * mustOverflow: 꼭 지킬 곳은 하루 관광지 수를 이만큼 넘겨도 그날에 넣음 · lunchAt: 낮 관광지의 이 비율 뒤에 점심
 * minutesPerKm: 순서 비교에서 카카오 자동차 시간이 하나도 없을 때 쓰는 1km당 분
 */
export const SCHEDULE = {
  perDayRange: [2, 6],
  popularityWeight: 0.02,
  poolPenalty: 1,
  sameKindPenalty: 3,
  kindDigits: 6,
  distPenaltyPerKm: 0.15,
  anchors: 6,
  mealPrioPerKm: 0.3,
  meals: { lunch: ['11:30', '13:30'], dinner: ['17:30', '19:30'] },
  mealCodes: ['FD01', 'FD02', 'FD0302', 'FD0303', 'FD0304', 'FD0305', 'FD0306'],
  night: { code: 'VE0102', like: 'like_night', zenith: 102 },
  heavyMoveShare: 0.3,
  parallel: 6,
  fareRoundWon: 100,
  orderAllMax: 8,
  mustOverflow: 1,
  lunchAt: 0.5,
  minutesPerKm: 1,
} as const;

/** 구간 이동 수단 (명세서 moveFromPrev.mode, v1.8에서 car 추가) */
export type LegMode = 'walk' | 'bus' | 'subway' | 'train' | 'taxi' | 'car';

/** 구간 하나 (명세서 GET /plan의 moveFromPrev). minutes·fareWon은 카카오가 준 값, 카카오를 못 쓰면 minutes 없이 직선거리만 (source estimate) */
export type MoveLeg = {
  mode: LegMode | null;
  minutes: number | null;
  distanceM: number;
  /** 1인 요금(원): 대중교통 요금, 택시는 한 대 요금 ÷ 참여 인원, 도보 0, 자차는 null */
  fareWon: number | null;
  source: 'kakao_route' | 'estimate';
  routeUrl: string | null;
  /** 같은 구간의 다른 가는 길 (사람이 고름) */
  options: {
    transit?: { mode: LegMode; minutes: number; distanceM: number; fareWon: number | null; transfers: number; lines: string[]; routeUrl: string | null };
    car?: { minutes: number; distanceM: number; taxiFareWon: number | null; taxiPerPersonWon: number | null; tollWon: number | null };
    walk?: { minutes: number; distanceM: number; routeUrl: string | null };
  };
  note?: string;
};

export type PlanStop = {
  /** 일정 항목 id (안·날·순서) */
  itemId: string;
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'sight' | 'food' | 'lodging';
  category: string | null;
  meal: 'lunch' | 'dinner' | null;
  /** 야경으로 그날 마지막에 둔 곳 */
  night: boolean;
  /** 꼭 지킬 곳인 구성원 · 좋아요가 붙은 구성원 */
  mustFor: string[];
  likedBy: string[];
  moveFromPrev: MoveLeg | null;
};
export type PlanDay = {
  day: number;
  date: string;
  stops: PlanStop[];
  /** moveMinutes: 카카오 구간 시간의 합 · unknownLegs: 길찾기를 못 한 구간 수 · heavy: 하루 시간 대비 이동이 많음 */
  summary: { moveMinutes: number; unknownLegs: number; spanMinutes: number; heavy: boolean };
};
/** 일정안 하나 (명세서 plan.proposed의 data: planId·version·route[day, stops[itemId, name, lat, lng]]에 v1.8 칸을 더함) */
export type PlanProposal = {
  planId: string;
  version: number;
  label: 'A' | 'B';
  moveMode: MoveMode;
  lodging: { placeId: string; name: string } | null;
  route: PlanDay[];
  notes: string[];
  /** 9단계 수정으로 다시 짠 안만: 이 버전에서 바뀐 것 (코드가 씀, 예: '1일째 광안리해수욕장 뺌 → 해운대해수욕장') */
  changes?: string[];
};

/** 동선에 넣을 수 있는 곳 (2단계 후보·보드·DB에서 보충한 식당) */
interface Spot {
  id: string;
  name: string;
  type: number;
  code: string | null;
  category: string | null;
  lat: number;
  lng: number;
  open: OpenHours | null;
  rest: string | null;
  marks: Record<string, Mark[]>;
  /** 고르는 점수: 반응 점수(고름 +2 · 👍 +1 · ⚠ −1) + 인기도 − 보드 밖 감점 */
  prio: number;
  /** 고른 AI 수 (숙소 고르기) */
  proposed: number;
  /** 끼니로 가는 음식점 (카페는 관광지처럼 둠) */
  meal: boolean;
  must: boolean;
  /** 시작 시각이 모두 저녁 시작 뒤인 곳 (예: 드론쇼 '19:00, 21:00', 야시장 18:00~): 저녁 뒤에 둠 */
  evening: boolean;
}

interface Ctx {
  members: readonly MemberInput[];
  dates: string[];
  attractions: Spot[];
  meals: Spot[];
  everywhere: Spot[];
  lodging: Spot | null;
  perDay: number;
  lunch: boolean;
  dinner: boolean;
  dusks: (number | null)[];
  nightLovers: number;
  /** 가장 엄격한 한 번 이동 상한(분, 싫어요 '오래 이동'). 없으면 null */
  moveLimit: number | null;
  spanMinutes: number;
  center: Point | null;
  moveMode: MoveMode;
  router: RouteClient;
  /** 5단계에서 사람이 남긴 곳 (원래 id): 이동 상한 고치기도 빼지 않음 */
  kept: Set<string>;
}

interface PlanState {
  label: 'A' | 'B';
  sets: Spot[][];
  /** 이 안에서 쓴 식당 (날마다 다른 곳) · B안이 되도록 피할 A안의 식당 */
  usedMeals: Set<string>;
  softMeals: Set<string>;
  /** 회의에서 이 안에서 뺀 곳 (9단계 수정·이동 상한 고치기): 끼니·채우기에 다시 쓰지 않음, 넣기 요청이 오면 풂 */
  banned: Set<string>;
  /** 9단계 수정에서 요청대로 넣은 곳 (넣기의 곳·바꾸기의 바꿀 곳): 다시 짤 때 이동 상한 고치기가 빼지 않음 (넣었다고 적었는데 사라지지 않게) */
  keep: Set<string>;
  /** 이동 상한 고치기를 하지 않는 날 (9단계에서 고치지 않은 날: 다시 짤 때마다 한 곳씩 더 빠지지 않게) */
  frozen: Set<number>;
  /** 14단계에서 사람이 정한 날마다 관광지 순서 (원래 id, 없으면 자동차 길찾기로 정함) */
  orders: (string[] | null)[];
  /** 14단계에서 사람이 고른 끼니 식당 (날마다 점심·저녁, 원래 id) */
  mealPins: MealPins[];
  notes: string[];
}
/** 날마다 사람이 고른 끼니 식당 */
export type MealPins = { lunch?: string; dinner?: string };

/**
 * 6단계에서 짠 한 안의 재료 (id만 두어 회의 상태에 저장, 9단계 수정이 이어서 씀)
 * sets: 날마다 넣은 곳(관광지·꼭 지킬 식당, 끼니 식당은 짤 때마다 고름) · banned: 회의에서 뺀 곳 · shared: B안이 A안과 같이 쓰는 곳(꼭 지킬 곳·A안 1순위)
 */
export interface PlanSets {
  sets: string[][];
  banned: string[];
  shared: string[];
  /** 14단계 사람 고치기에서만: 날마다 사람이 정한 관광지 순서·고른 끼니 식당 */
  orders?: (string[] | null)[];
  mealPins?: MealPins[];
}
export type PlanStates = Record<'A' | 'B', PlanSets>;

const DAY = 1440;
const KST_MINUTES = 9 * 60;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const byPrio = (list: readonly Spot[]) => [...list].sort((a, b) => b.prio - a.prio || a.id.localeCompare(b.id));
const marksOf = (p: Spot, m: MemberInput) => p.marks[m.memberId] ?? [];
const kindOf = (p: Spot) => p.code?.slice(0, SCHEDULE.kindDigits) ?? null;
/** 끼니로 가는 음식점인지 (분류 코드가 없는 음식점은 끼니로 봄) */
const isMeal = (type: number, code: string | null) => type === RETRIEVE.foodType && (code === null || SCHEDULE.mealCodes.some((c) => code.startsWith(c)));

/**
 * 그날 저녁 해가 천정에서 zenith°가 되는 시각 (한국 시간, 0시부터의 분). NOAA 일출·일몰 계산식
 * zenith 90.833 = 일몰, 102 = 항해박명 끝. 계산되지 않으면(극지) null
 */
export function duskKst(p: Point, ymd: string, zenith: number): number | null {
  const d = new Date(`${ymd}T00:00:00Z`);
  const n = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY_MS);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const la = (p.lat * Math.PI) / 180;
  const cosHa = Math.cos((zenith * Math.PI) / 180) / (Math.cos(la) * Math.cos(dec)) - Math.tan(la) * Math.tan(dec);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = (Math.acos(cosHa) * 180) / Math.PI;
  return Math.round(720 - 4 * (p.lng - ha) - eq + KST_MINUTES);
}

/** at(분)에 열려 있는지 (영업시간을 모르면 false: 야경 자리에 두지 않음) */
const openAt = (open: OpenHours | null, at: number) => {
  if (!open) return false;
  const close = open.close <= open.open ? open.close + DAY : open.close;
  return at >= open.open && at < close;
};
const isNightSpot = (p: Spot, dusk: number) => !!p.code?.startsWith(SCHEDULE.night.code) && openAt(p.open, dusk);
const DINNER_START = toMinutes(SCHEDULE.meals.dinner[0]);
/** 카카오에 묻지 못한 구간의 메모 (한도·오류·교통 장애). 카카오가 '경로 없음'으로 답한 구간과 나눠 셈 */
const UNAVAILABLE = '길찾기 정보 없음';
/** 시간 문장의 시작 시각(구간이면 앞 시각, 하나뿐이면 그 시각)이 모두 t분 뒤인지. 시각이 하나도 없으면 false */
function startsAllAfter(raw: string | null, t: number): boolean {
  if (!raw) return false;
  const starts = [...raw.matchAll(/(\d{1,2}):(\d{2})(?:\s*[~\-–]\s*\d{1,2}:\d{2})?/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  return starts.length > 0 && starts.every((v) => v >= t);
}

/** 여러 일을 parallel개씩 나눠 동시에 함 (카카오에 한꺼번에 몰리지 않게) */
async function inChunks<T>(tasks: readonly (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

/**
 * 끼니 보충: 2단계 후보의 식당은 몇 곳뿐이라 여행지의 다른 식당을 DB에서 더 읽음 (LLM 0 · 외부 API 0)
 * 2단계와 같은 규칙: 꼭 피할 것에 걸리거나 여행 날짜가 모두 휴무면 뺌. 좋아요·꼭 지킬 것·싫어요 표시는 공식 분류 코드·규칙 함수로
 */
async function moreRestaurants(db: Db, pool: RetrieveResult, members: readonly MemberInput[]): Promise<Spot[]> {
  const dest = pool.destination;
  const inPool = new Set([...pool.candidates, ...pool.lodgings].map((c) => c.id));
  const rows = await db
    .select({ id: places.contentId, title: places.title, lcls3: places.lcls3, introRaw: places.introRaw, lat: places.lat, lng: places.lng, districtCode: places.districtCode })
    .from(places)
    .where(
      and(
        eq(places.visible, true),
        eq(places.regionCode, dest.regionCode),
        eq(places.contentTypeId, RETRIEVE.foodType),
        // 끼니로 가는 음식점 분류만 읽음 (카페·주점·제과는 끼니가 아님, 아래 isMeal과 같은 잣대 · 라운드마다 다시 읽으므로 행 수를 줄임)
        or(...SCHEDULE.mealCodes.map((c) => like(places.lcls3, `${c}%`))),
        dest.districtCodes.length ? inArray(places.districtCode, dest.districtCodes) : undefined,
      ),
    );
  // 장소·음식 이름·지역 규칙은 2단계 LLM이 고른 장소 id·구·군 코드로만 맞춤 (10/29 사용자 결정: 코드가 글자로 같은 음식 식당·같은 이름의 구를 찾지 않음)
  // 그래서 꼭 먹을 음식은 LLM이 고른 식당(규칙마다 최대 NAME_MATCH.pickMax곳) 안에서만 끼니에 들어감. 10/29 전 회의의 기록에는 type이 없음(넣기만 있었음)
  const matcherOf = (memberId: string, r: MustKeepRule): ((v: RulePlace) => boolean) => {
    if (!isNameRule(r) && !isAreaRule(r)) return ruleMatcher(r);
    const hits = (pool.nameMatches ?? []).filter((n) => n.memberId === memberId && (n.type ?? 'include') === r.type && n.label === r.label && n.keyword === r.keyword?.trim());
    const ids = new Set(hits.flatMap((n) => n.ids ?? []));
    const districts = new Set(hits.flatMap((n) => n.districts ?? []));
    return (v) => (!!v.id && ids.has(v.id)) || (!!v.districtCode && districts.has(v.districtCode));
  };
  const avoids = members.flatMap((m) => m.mustKeep.filter((r) => r.type === 'avoid' && !isLegacyRule(r) && !isDietAvoid(r)).map((r) => matcherOf(m.memberId, r)));
  // 장소 이름 규칙은 후보에 숙소·가게가 아닌 꼭 지킬 곳이 있으면 식당에 붙이지 않음 (2단계와 같은 규칙, 10/27 사용자 결정)
  const visitMust = new Set(
    [...pool.candidates, ...pool.lodgings]
      .filter((c) => !isBusiness(c.code ?? null))
      .flatMap((c) => Object.entries(c.marks).flatMap(([memberId, ks]) => ks.filter((k) => k.kind === 'must').map((k) => `${memberId}\n${k.label}`))),
  );
  // 지역 규칙은 식당에 붙이지 않음: 그 구·군의 식당이 모두 꼭 지킬 곳이 되고, 여행지 전체를 가리켜 2단계에서 쓰지 않은 규칙이 식당으로 되살아남 (10/28 점검)
  const includes = new Map(
    members.map((m) => [
      m.memberId,
      m.mustKeep
        .filter((r) => r.type === 'include' && !isLegacyRule(r) && r.target !== 'area' && !(r.target === 'place' && visitMust.has(`${m.memberId}\n${r.label}`)))
        .map((r) => ({ label: r.label, matches: matcherOf(m.memberId, r) })),
    ]),
  );
  const names = new Map((await db.select({ code: categories.code, name: categories.name3 }).from(categories)).map((r) => [r.code, r.name]));
  const month = Number(pool.dates[0].slice(5, 7));
  return rows.flatMap((p): Spot[] => {
    if (inPool.has(p.id) || p.lat === null || p.lng === null || !p.lcls3 || !isMeal(RETRIEVE.foodType, p.lcls3)) return [];
    const view = { id: p.id, title: p.title, code: p.lcls3, districtCode: p.districtCode, isFood: true, menu: [intro(p.introRaw, 'firstmenu'), intro(p.introRaw, 'treatmenu')].filter(Boolean).join(' ') || null };
    const rest = intro(p.introRaw, ...REST_KEYS);
    if (avoids.some((f) => f(view)) || pool.dates.every((d) => closedOn(rest, d) === 'closed')) return [];
    const marks: Record<string, Mark[]> = {};
    for (const m of members) {
      const mk: Mark[] = [];
      const liked = m.likes.filter((l) => likeMatches(l, view));
      if (liked.length) mk.push({ kind: 'like', label: liked.map(likeText).join('·') });
      for (const k of includes.get(m.memberId) ?? []) if (k.matches(view)) mk.push({ kind: 'must', label: k.label });
      for (const d of m.dislikes.filter((x) => dislikeMatches(x, view))) mk.push({ kind: 'dislike', label: dislikeText(d) });
      marks[m.memberId] = mk;
    }
    // 반응 점수와 같은 잣대: 좋아요 +1 · 싫어요 −1 (사람마다 한 번), 보드 밖이라 감점
    const count = (kind: Mark['kind']) => Object.values(marks).filter((ks) => ks.some((k) => k.kind === kind)).length;
    return [
      {
        id: p.id,
        name: p.title,
        type: RETRIEVE.foodType,
        code: p.lcls3,
        category: names.get(p.lcls3) ?? null,
        lat: p.lat,
        lng: p.lng,
        open: hoursOn(intro(p.introRaw, ...HOURS_KEYS), month),
        rest,
        marks,
        prio: count('like') * REACT.score.like + count('dislike') * REACT.score.warn - SCHEDULE.poolPenalty,
        proposed: 0,
        meal: true,
        must: count('must') > 0,
        evening: false,
      },
    ];
  });
}

/**
 * 2단계 후보·보드를 동선 재료로: 보드에 있으면 4단계 반응 점수(AI 반응 포함), 없으면 코드 반응으로 셈
 * ✕가 붙은 곳은 빼되 5단계에서 사람이 남기기로 한 곳은 넣음 (사람의 결정이 먼저). 사람이 뺀 곳은 다시 넣지 않음
 */
function spotsOf(
  pool: RetrieveResult,
  board: Board,
  members: readonly MemberInput[],
  decision: ReviewDecision | null,
  filled: ReadonlyMap<string, { code: string | null; rest: string | null; hours: string | null }>,
) {
  const kept = new Set(decision?.kept ?? []);
  const dropped = new Set(decision?.dropped ?? []);
  const onBoard = new Map(board.candidates.map((b) => [b.placeId, b]));
  const lodgingIds = new Set(pool.lodgings.map((c) => c.id));
  const toSpot = (c: Candidate): Spot | null => {
    const placeId = placeIdOf(c.id);
    if (dropped.has(placeId) || c.lat === null || c.lng === null) return null;
    const b = onBoard.get(placeId);
    let score: number;
    let blocked: boolean;
    if (b) ({ score, blocked } = reactionScore(b));
    else {
      const rs = members.map((m) => reactionOf(c, m, { lodging: lodgingIds.has(c.id), proposed: false }));
      blocked = rs.some((r) => r?.kind === 'block');
      score = rs.filter((r) => r?.kind === 'like').length * REACT.score.like + rs.filter((r) => r?.kind === 'warn').length * REACT.score.warn - SCHEDULE.poolPenalty;
    }
    if (blocked && !kept.has(placeId)) return null;
    const code = c.code !== undefined ? c.code : (filled.get(c.id)?.code ?? null);
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      code,
      category: c.category,
      lat: c.lat,
      lng: c.lng,
      open: c.open,
      rest: c.rest !== undefined ? c.rest : (filled.get(c.id)?.rest ?? null),
      marks: c.marks,
      prio: score + (c.popularity ?? 0) * SCHEDULE.popularityWeight,
      proposed: b?.proposedBy.length ?? 0,
      meal: isMeal(c.type, code),
      must: Object.values(c.marks).some((ks) => ks.some((k) => k.kind === 'must')),
      evening: c.open ? c.open.open >= DINNER_START && c.open.open < DAY : startsAllAfter(filled.get(c.id)?.hours ?? null, DINNER_START),
    };
  };
  return {
    spots: pool.candidates.map(toSpot).filter((s): s is Spot => s !== null),
    lodgings: pool.lodgings.map(toSpot).filter((s): s is Spot => s !== null),
  };
}

/** 꼭 지킬 것(사람·항목)마다 넣을 곳 하나. avoid(다른 안에서 쓴 곳)에 없는 곳을 먼저 고름 */
function requiredPlaces(ctx: Ctx, avoid: ReadonlySet<string>): Spot[] {
  const out: Spot[] = [];
  for (const m of ctx.members) {
    for (const r of m.mustKeep) {
      if (r.type !== 'include') continue;
      const all = ctx.everywhere.filter((p) => marksOf(p, m).some((k) => k.kind === 'must' && k.label === r.label));
      if (!all.length || out.some((p) => all.includes(p))) continue;
      const fresh = all.filter((p) => !avoid.has(p.id));
      out.push(byPrio(fresh.length ? fresh : all)[0]);
    }
  }
  return out;
}

/**
 * 날마다 넣을 곳: 꼭 지킬 곳을 가까운 날에 먼저 놓고, 묶음 가운데에서 가깝고 점수가 큰 곳으로 하루 관광지 수까지 채움 (직선거리, 고르기에만 씀)
 * 1박 이상이면 날마다 숙소에서 나가거나 숙소로 돌아오므로 숙소도 묶음 가운데 계산에 넣음 (숙소에서 먼 곳으로 하루를 채우지 않게)
 * 좋아요가 하나도 안 들어간 사람이 있으면 그 사람이 좋아하는 곳 1곳을 넣음 (꼭 지킬 곳은 빼지 않음)
 * 그날 쉬는 곳은 그날에 넣지 않음 (10/27 사용자 결정: 그날 쉬면 빼고 다른 곳(차선)을 넣음). 꼭 지킬 곳은 여는 날로 옮김 (여행 날짜가 모두 휴무인 곳은 2단계에서 이미 빠짐)
 */
function pickSets(ctx: Ctx, avoid: ReadonlySet<string>, required: readonly Spot[]): Spot[][] {
  const D = ctx.dates.length;
  const sets: Spot[][] = Array.from({ length: D }, () => []);
  const attrCount = (d: number) => sets[d].filter((q) => !q.meal).length;
  const mealsPerDay = Number(ctx.lunch) + Number(ctx.dinner);
  const openOn = (p: Spot, d: number) => closedOn(p.rest, ctx.dates[d]) !== 'closed';
  for (const p of byPrio(required)) {
    const open = Array.from({ length: D }, (_, d) => d).filter((d) => openOn(p, d));
    const full = (d: number) => (p.meal ? sets[d].filter((q) => q.meal).length >= mealsPerDay : attrCount(d) >= ctx.perDay + SCHEDULE.mustOverflow);
    const near = (d: number) => {
      const c = centerOf(sets[d]);
      return c ? distanceKm(c, p) : 0;
    };
    // 여는 날 중 자리가 있는 가장 가까운 날, 여는 날이 모두 찼으면 그중 가장 덜 찬 날 (꼭 지킬 곳이 휴무 때문에 사라지지 않게)
    const roomy = open.filter((d) => !full(d)).sort((a, b) => near(a) - near(b) || a - b);
    const best = roomy[0] ?? open.sort((a, b) => sets[a].length - sets[b].length || a - b)[0];
    if (best !== undefined) sets[best].push(p);
  }
  const used = new Set(sets.flat().map((p) => p.id));
  const fresh = ctx.attractions.filter((p) => !avoid.has(p.id));
  const reuse = ctx.attractions.filter((p) => avoid.has(p.id)).sort((a, b) => a.prio - b.prio || a.id.localeCompare(b.id));
  // 묶음 값: 점수 − 가운데에서 거리 − 같은 소분류가 이미 있으면 감점 (이 안의 다른 날 포함)
  const value = (p: Spot, c: Point | null, chosen: readonly Spot[]) =>
    p.prio - SCHEDULE.distPenaltyPerKm * (c ? distanceKm(c, p) : 0) - SCHEDULE.sameKindPenalty * chosen.filter((q) => q.id !== p.id && kindOf(q) !== null && kindOf(q) === kindOf(p)).length;
  const home = ctx.lodging ? [ctx.lodging] : [];
  // d날에 채울 곳: 그날 쉬는 곳은 고르지 않음 (다음 순위 곳이 그 자리를 채움)
  const grow = (set: Spot[], limit: number, d: number) => {
    const ids = new Set(set.map((p) => p.id));
    const out = set.slice();
    while (out.filter((q) => !q.meal).length < limit) {
      const c = centerOf([...out, ...home]);
      const chosen = [...sets.flat(), ...out];
      const free = (p: Spot) => !used.has(p.id) && !ids.has(p.id) && openOn(p, d);
      const next =
        fresh
          .filter(free)
          .map((p) => ({ p, v: value(p, c, chosen) }))
          .sort((a, b) => b.v - a.v || a.p.id.localeCompare(b.p.id))[0]?.p ?? reuse.find(free);
      if (!next) break;
      out.push(next);
      ids.add(next.id);
    }
    return out;
  };
  for (let d = 0; d < D; d++) {
    if (!sets[d].length) {
      // 빈 날: 점수 상위 몇 곳을 하나씩 가운데로 놓아 보고 묶음 값이 가장 큰 것
      const anchors = byPrio(fresh.filter((p) => !used.has(p.id) && openOn(p, d))).slice(0, SCHEDULE.anchors);
      let best: { set: Spot[]; v: number } | null = null;
      for (const a of anchors) {
        const set = grow([a], ctx.perDay, d);
        const c = centerOf([...set, ...home]);
        const v = set.reduce((acc, p) => acc + value(p, c, [...sets.flat(), ...set]), 0);
        if (!best || v > best.v) best = { set, v };
      }
      sets[d] = best?.set ?? grow([], ctx.perDay, d);
    } else sets[d] = grow(sets[d], ctx.perDay, d);
    sets[d].forEach((p) => used.add(p.id));
  }
  for (const m of ctx.members) {
    const liked = (p: Spot) => marksOf(p, m).some((k) => k.kind === 'like');
    if (sets.flat().some(liked)) continue;
    const cand = byPrio([...fresh, ...reuse].filter((p) => !used.has(p.id) && liked(p) && !marksOf(p, m).some((k) => k.kind === 'dislike' || k.kind === 'crowd')))[0];
    if (!cand) continue;
    // 그곳이 여는 날 중 가장 가까운 날에서 꼭 지킬 곳이 아니고 좋아하는 사람이 가장 적은, 점수가 가장 낮은 곳과 바꿈
    const days = sets.map((x, i) => ({ i, v: x.length ? Math.min(...x.map((q) => distanceKm(q, cand))) : 0 })).filter((x) => openOn(cand, x.i));
    if (!days.length) continue;
    const d = days.sort((a, b) => a.v - b.v || a.i - b.i)[0].i;
    const fans = (q: Spot) => ctx.members.filter((o) => marksOf(q, o).some((k) => k.kind === 'like')).length;
    const out = sets[d].filter((q) => !q.meal && !q.must).sort((a, b) => fans(a) - fans(b) || a.prio - b.prio || a.id.localeCompare(b.id))[0];
    if (out && sets[d].filter((q) => !q.meal).length >= ctx.perDay) sets[d] = sets[d].filter((q) => q.id !== out.id);
    sets[d].push(cand);
    used.add(cand.id);
  }
  return sets;
}

/** 모든 순서를 하나씩 만듦 (한꺼번에 만들지 않음). 순서는 예전과 같음: 앞 곳을 차례로 고르고 나머지를 같은 방식으로 */
function* permutations<T>(a: readonly T[]): Generator<T[]> {
  if (a.length <= 1) {
    yield a.slice();
    return;
  }
  for (let i = 0; i < a.length; i++) for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...rest];
}

/**
 * 순서 비교용 자동차 이동 분 (오가는 방향은 같은 구간으로 봄, 카카오모빌리티). 카카오를 못 쓴 구간은 다른 구간의 분/km 비율(중앙값)로 채움
 * 채운 값은 순서를 비교할 때만 쓰고 화면에는 보내지 않음
 */
async function carWeights(router: RouteClient, points: readonly Spot[]): Promise<(a: Spot, b: Spot) => number> {
  const pairs: [Spot, Spot][] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) pairs.push([points[i], points[j]]);
  const minutes = await inChunks(
    pairs.map(([a, b]) => () => router.car(a, b).then((r) => r?.minutes ?? null, () => null)),
    SCHEDULE.parallel,
  );
  const ratios = pairs
    .map(([a, b], i) => ({ km: distanceKm(a, b), min: minutes[i] }))
    .filter((x): x is { km: number; min: number } => x.min !== null && x.km > 0)
    .map((x) => x.min / x.km)
    .sort((a, b) => a - b);
  const ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : SCHEDULE.minutesPerKm;
  const w = new Map<string, number>();
  pairs.forEach(([a, b], i) => {
    const v = minutes[i] ?? distanceKm(a, b) * ratio;
    w.set(`${a.id}|${b.id}`, v);
    w.set(`${b.id}|${a.id}`, v);
  });
  return (a, b) => (a.id === b.id ? 0 : (w.get(`${a.id}|${b.id}`) ?? distanceKm(a, b) * ratio));
}

/**
 * 하루 관광지 순서: 모든 순서를 따져(6곳 = 720가지) 자동차 이동 분의 합이 가장 적은 순서 (숙소에서 나오고 숙소로 돌아가는 구간 포함)
 * tail(저녁 뒤에 둘 곳: 밤 행사, 마지막에 야경)은 그 순서대로 끝에 둠
 */
async function orderDay(router: RouteClient, attrs: readonly Spot[], tail: readonly Spot[], from: Spot | null, to: Spot | null): Promise<Spot[]> {
  if (attrs.length <= 1) return attrs.slice();
  const points = [...new Map([...(from ? [from] : []), ...(to ? [to] : []), ...attrs].map((p) => [p.id, p])).values()];
  const w = await carWeights(router, points);
  const free = [...attrs].filter((p) => !tail.includes(p)).sort((a, b) => a.id.localeCompare(b.id));
  const costOf = (order: readonly Spot[]) => {
    let cost = 0;
    for (let i = 1; i < order.length; i++) cost += w(order[i - 1], order[i]);
    if (from && order.length) cost += w(from, order[0]);
    if (to && order.length) cost += w(order[order.length - 1], to);
    return cost;
  };
  if (free.length > SCHEDULE.orderAllMax) return [...shortOrder(free, from, w, (o) => costOf([...o, ...tail])), ...tail];
  let best: { order: Spot[]; cost: number } | null = null;
  for (const perm of permutations(free)) {
    const order = [...perm, ...tail];
    const cost = costOf(order);
    if (!best || cost < best.cost) best = { order, cost };
  }
  return best?.order ?? attrs.slice();
}

/** 곳이 많을 때의 순서: 출발점(없으면 첫 곳)에서 가까운 곳부터 잇고, 두 곳 사이를 뒤집어 짧아지면 바꾸기를 더 나아지지 않을 때까지 (2-opt) */
function shortOrder(free: readonly Spot[], from: Spot | null, w: (a: Spot, b: Spot) => number, costOf: (order: readonly Spot[]) => number): Spot[] {
  const left = free.slice();
  const order: Spot[] = [];
  let at = from ?? left.shift()!;
  if (!from) order.push(at);
  while (left.length) {
    let k = 0;
    for (let i = 1; i < left.length; i++) if (w(at, left[i]) < w(at, left[k])) k = i;
    at = left.splice(k, 1)[0];
    order.push(at);
  }
  let best = costOf(order);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++)
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const cost = costOf(next);
        if (cost < best) {
          best = cost;
          order.splice(0, order.length, ...next);
          improved = true;
        }
      }
  }
  return order;
}

const transitMode = (type: string): LegMode => (type.includes('TRAIN') ? 'train' : type.includes('SUBWAY') && !type.includes('BUS') ? 'subway' : 'bus');
const walkOption = (w: WalkLeg) => ({ minutes: w.minutes, distanceM: w.distanceM, routeUrl: w.url });
const transitOption = (t: TransitLeg) => ({ mode: transitMode(t.type), minutes: t.minutes, distanceM: t.distanceM, fareWon: t.fare, transfers: t.transfers, lines: t.lines, routeUrl: t.url });
const carOption = (c: CarLeg, people: number) => ({
  minutes: c.minutes,
  distanceM: c.distanceM,
  taxiFareWon: c.taxiFare,
  taxiPerPersonWon: c.taxiFare === null ? null : Math.round(c.taxiFare / people / SCHEDULE.fareRoundWon) * SCHEDULE.fareRoundWon,
  tollWon: c.toll,
});

/**
 * 두 곳 사이 가는 길 (카카오, 우리 계산식 없음): 걸어갈 거리면 도보, 자차면 자동차, 대중교통이면 대중교통과 택시를 함께 물어 대중교통을 권함
 * 택시를 권하는 때: 대중교통 경로가 없거나, 대중교통이 누군가의 한 번 이동 상한을 넘고 택시는 안 넘을 때
 * 카카오를 못 쓰면(한도·오류) 시간 없이 직선거리만 (estimate)
 */
async function legBetween(ctx: Ctx, a: Spot, b: Spot): Promise<MoveLeg> {
  const km = distanceKm(a, b);
  const walkable = km * TRAVEL.detour <= TRAVEL.walkMaxKm;
  const estimate = (note: string): MoveLeg => ({ mode: walkable ? 'walk' : null, minutes: null, distanceM: Math.round(km * 1000), fareWon: null, source: 'estimate', routeUrl: null, options: {}, note });
  const ask = <T>(p: Promise<T | null>) => p.then((v) => ({ ok: true, v }), () => ({ ok: false, v: null as T | null }));
  if (walkable) {
    const w = await ask(ctx.router.walk(a, b));
    if (!w.v) return estimate(w.ok ? '도보 경로 없음' : UNAVAILABLE);
    return { mode: 'walk', minutes: w.v.minutes, distanceM: w.v.distanceM, fareWon: 0, source: 'kakao_route', routeUrl: w.v.url, options: { walk: walkOption(w.v) } };
  }
  if (ctx.moveMode === 'car') {
    const c = await ask(ctx.router.car(a, b));
    if (!c.v) return estimate(c.ok ? '자동차 경로 없음' : UNAVAILABLE);
    return { mode: 'car', minutes: c.v.minutes, distanceM: c.v.distanceM, fareWon: null, source: 'kakao_route', routeUrl: null, options: { car: carOption(c.v, ctx.members.length) } };
  }
  const [t, c] = await Promise.all([ask(ctx.router.transit(a, b)), ask(ctx.router.car(a, b))]);
  const car = c.v ? carOption(c.v, ctx.members.length) : null;
  const options: MoveLeg['options'] = { ...(t.v && { transit: transitOption(t.v) }), ...(car && { car }) };
  const taxi = (note: string): MoveLeg => ({ mode: 'taxi', minutes: car!.minutes, distanceM: car!.distanceM, fareWon: car!.taxiPerPersonWon, source: 'kakao_route', routeUrl: null, options, note });
  if (t.v) {
    if (ctx.moveLimit !== null && t.v.minutes > ctx.moveLimit && car && car.minutes <= ctx.moveLimit) return taxi(`대중교통 ${t.v.minutes}분이 한 번 이동 상한 ${ctx.moveLimit}분을 넘어 택시`);
    return { mode: transitMode(t.v.type), minutes: t.v.minutes, distanceM: t.v.distanceM, fareWon: t.v.fare, source: 'kakao_route', routeUrl: t.v.url, options };
  }
  if (car) return taxi(t.ok ? '대중교통 경로 없음' : '대중교통 길찾기 정보 없음');
  return estimate(t.ok || c.ok ? '대중교통·자동차 경로 없음' : UNAVAILABLE);
}

type Slot = 'lunch' | 'dinner';
const SLOT_LABEL: Record<Slot, string> = { lunch: '점심', dinner: '저녁' };

/** 식당이 동선에서 벗어나는 거리(km, 직선): 앞 장소 → 식당 → 다음 장소가 앞 → 다음보다 얼마나 더 먼지 */
function detourKm(ctx: Ctx, prev: Spot | null, r: Spot, next: Spot | null): number {
  if (prev && next) return distanceKm(prev, r) + distanceKm(r, next) - distanceKm(prev, next);
  const ref = prev ?? next ?? ctx.center;
  return ref ? distanceKm(ref, r) : 0;
}

/** 사람이 정한 순서 (그 순서에 없는 곳은 점수 순으로 뒤에) */
function pinnedOrder(attrs: readonly Spot[], ids: readonly string[]): Spot[] {
  const at = (p: Spot) => {
    const k = ids.indexOf(p.id);
    return k < 0 ? Infinity : k;
  };
  return [...attrs].sort((a, b) => at(a) - at(b) || b.prio - a.prio || a.id.localeCompare(b.id));
}

/**
 * 하루 짜기: 순서(자동차 길찾기) → 끼니 자리(관광지 절반 뒤 점심, 마지막 관광지 뒤 저녁, 밤 행사·야경은 저녁 뒤) → 식당(꼭 지킬 식당 먼저, 그다음 동선에서 덜 벗어나고 점수가 큰 곳) → 구간 가는 길
 * 한 번 이동이 가장 엄격한 상한을 넘는 구간이 있으면 그 끝의 관광지(꼭 지킬 곳 아님, 다른 관광지들에서 더 먼 쪽)를 한 번 빼고 다시 짬
 */
async function buildDay(ctx: Ctx, st: PlanState, i: number, retried = st.frozen.has(i)): Promise<PlanDay> {
  const date = ctx.dates[i];
  const notes: string[] = [];
  const set = st.sets[i] ?? [];
  const attrs = set.filter((p) => !p.meal);
  const reqMeals = byPrio(set.filter((p) => p.meal));
  const dusk = ctx.dusks[i];
  const night = ctx.nightLovers > 0 && dusk !== null ? (byPrio(attrs.filter((p) => isNightSpot(p, dusk)))[0] ?? null) : null;
  const from = i > 0 ? ctx.lodging : null;
  const to = i < ctx.dates.length - 1 ? ctx.lodging : null;
  // 사람이 순서를 정한 날(14단계)은 그 순서 그대로, 정하지 않은 날은 자동차 길찾기로 가장 짧은 순서
  // 밤 행사·야경은 사람이 순서를 정해도 저녁 뒤 자리에 둠 (시작 시각·해 진 뒤가 정해진 곳, 그 사이 순서만 사람이 정한 대로)
  const pinned = st.orders[i] ?? null;
  const late = attrs.filter((p) => (p.evening && p !== night) || p === night);
  const tail = pinned ? pinnedOrder(late, pinned) : [...late.filter((p) => p !== night).sort((a, b) => a.id.localeCompare(b.id)), ...(night ? [night] : [])];
  const order = pinned ? pinnedOrder(attrs, pinned) : await orderDay(ctx.router, attrs, tail, from, to);
  if (pinned && tail.some((p) => pinned.indexOf(p.id) >= 0 && attrs.some((q) => !tail.includes(q) && pinned.indexOf(q.id) > pinned.indexOf(p.id))))
    notes.push(`${i + 1}일째 ${tail.map((p) => p.name).join('·')}은(는) 밤에 가는 곳이라 저녁 뒤 자리 그대로`);
  const daytime = order.filter((p) => !tail.includes(p));
  const cut = Math.floor(daytime.length * SCHEDULE.lunchAt);
  const seq: (Spot | Slot)[] = [...daytime.slice(0, cut), ...(ctx.lunch ? (['lunch'] as const) : []), ...daytime.slice(cut), ...(ctx.dinner ? (['dinner'] as const) : []), ...tail];
  const around = (k: number) => {
    let prev: Spot | null = from;
    for (let j = k - 1; j >= 0; j--) if (typeof seq[j] !== 'string') { prev = seq[j] as Spot; break; }
    let next: Spot | null = to;
    for (let j = k + 1; j < seq.length; j++) if (typeof seq[j] !== 'string') { next = seq[j] as Spot; break; }
    return { prev, next };
  };
  const filled = new Map<number, Spot>();
  const slotsLeft = () => seq.map((s, k) => (typeof s === 'string' && !filled.has(k) ? k : -1)).filter((k) => k >= 0);
  // 사람이 고른 끼니 식당 (14단계): 그 끼니 자리에 먼저. 그날 쉬면 다른 식당으로
  const pins = st.mealPins[i] ?? {};
  for (const k of slotsLeft()) {
    const slot = seq[k] as Slot;
    const id = pins[slot];
    if (!id) continue;
    const r = ctx.meals.find((x) => x.id === id);
    if (r && closedOn(r.rest, date) !== 'closed') filled.set(k, r);
    else notes.push(`${i + 1}일째 ${SLOT_LABEL[slot]} — 고른 식당이 그날 쉬어 다른 식당으로`);
  }
  // 꼭 지킬 식당: 동선에서 덜 벗어나는 끼니 자리에
  for (const r of reqMeals) {
    const k = slotsLeft().sort((x, y) => detourKm(ctx, around(x).prev, r, around(x).next) - detourKm(ctx, around(y).prev, r, around(y).next) || x - y)[0];
    if (k === undefined) notes.push(`${i + 1}일째 ${r.name} — 끼니 자리가 없어 넣지 못함`);
    else filled.set(k, r);
  }
  // 나머지 끼니: 그날 쉬지 않고 끼니 시간대에 여는 식당 중 동선에서 덜 벗어나고 점수가 큰 곳 (이 안에서 쓴 식당은 다시 쓰지 않음, B안은 A안의 식당을 되도록 피함)
  // 다른 날에 꼭 지킬 식당으로 넣어 둔 곳도 쓰지 않음 (10/28 점검: 1일째 점심과 2일째 저녁에 같은 식당이 들어감)
  const elsewhere = new Set(st.sets.flatMap((x, d) => (d === i ? [] : x.filter((p) => p.meal).map((p) => p.id))));
  for (const k of slotsLeft()) {
    const slot = seq[k] as Slot;
    const [w0, w1] = SCHEDULE.meals[slot].map(toMinutes);
    const { prev, next } = around(k);
    const today = new Set([...filled.values()].map((r) => r.id));
    const ok = ctx.meals.filter(
      (r) => !st.usedMeals.has(r.id) && !st.banned.has(r.id) && !today.has(r.id) && !elsewhere.has(r.id) && closedOn(r.rest, date) !== 'closed' && (!r.open || overlapMinutes(r.open, w0, w1) > 0),
    );
    const rank = (list: readonly Spot[]) =>
      list
        .map((r) => ({ r, v: detourKm(ctx, prev, r, next) - SCHEDULE.mealPrioPerKm * r.prio }))
        .sort((a, b) => a.v - b.v || a.r.id.localeCompare(b.r.id))[0]?.r;
    const pick = rank(ok.filter((r) => !st.softMeals.has(r.id))) ?? rank(ok);
    if (pick) filled.set(k, pick);
    else notes.push(`${i + 1}일째 ${SLOT_LABEL[slot]} — 그날 여는 식당을 찾지 못함`);
  }
  type Visit = { spot: Spot; meal: Slot | null };
  const visits = seq.flatMap((s, k): Visit[] => (typeof s === 'string' ? (filled.has(k) ? [{ spot: filled.get(k)!, meal: s }] : []) : [{ spot: s, meal: null }]));
  const path: Visit[] = [...(from ? [{ spot: from, meal: null }] : []), ...visits, ...(to ? [{ spot: to, meal: null }] : [])];
  const legs = await inChunks(
    path.map((v, k) => () => (k === 0 ? Promise.resolve(null) : legBetween(ctx, path[k - 1].spot, v.spot))),
    Math.max(1, Math.floor(SCHEDULE.parallel / 2)),
  );

  // 한 번 이동이 가장 엄격한 상한을 넘으면(택시로도) 그 구간 끝의 관광지 하나를 빼고 다시 짬 (한 번만)
  if (!retried && ctx.moveLimit !== null && attrs.length > SCHEDULE.perDayRange[0]) {
    const k = legs.findIndex((l) => l?.minutes != null && l.minutes > ctx.moveLimit!);
    if (k > 0) {
      // 두 끝 중 그날 다른 관광지들의 가운데에서 더 먼 곳을 뺌. 더 먼 쪽이 숙소·식당·꼭 지킬 곳이면 빼도 긴 이동이 남으므로 빼지 않음
      const apart = (p: Spot) => {
        const c = centerOf(attrs.filter((q) => q !== p));
        return c ? distanceKm(c, p) : 0;
      };
      const [a, b] = [path[k].spot, path[k - 1].spot];
      const far = apart(a) > apart(b) || (apart(a) === apart(b) && a.id < b.id) ? a : b;
      const out = !far.meal && !far.must && !st.keep.has(far.id) && !ctx.kept.has(far.id) && far !== ctx.lodging && attrs.includes(far) ? far : null;
      if (out) {
        st.sets[i] = set.filter((p) => p !== out);
        // 뺀 곳은 이 안에서 다시 쓰지 않음 (9단계 채우기가 같은 곳을 다시 넣어 같은 긴 이동이 생기지 않게)
        st.banned.add(out.id);
        st.notes.push(`${i + 1}일째 ${out.name} 뺌 — ${path[k - 1].spot.name} → ${path[k].spot.name} 이동 ${legs[k]!.minutes}분 (가장 엄격한 한 번 이동 상한 ${ctx.moveLimit}분)`);
        return buildDay(ctx, st, i, true);
      }
    }
  }

  for (const v of visits) if (v.meal) st.usedMeals.add(v.spot.id);
  st.notes.push(...notes);
  const tag = st.label.toLowerCase();
  // 일정 항목 id = 안·날짜·장소 (자리 번호가 아님): 다른 사람이 먼저 고쳐 자리가 바뀐 뒤 옛 화면에서 보낸 고치기(14단계)가
  // 엉뚱한 곳을 바꾸지 않고 '지금 일정에 없는 항목'이 되게 함. 같은 날 같은 곳이 두 번이면(가운데 날 숙소) 뒤에 _2
  const seen = new Map<string, number>();
  const stops: PlanStop[] = path.map((v, k) => {
    const n = (seen.get(v.spot.id) ?? 0) + 1;
    seen.set(v.spot.id, n);
    return {
      itemId: `itm_${tag}${i + 1}_${v.spot.id}${n > 1 ? `_${n}` : ''}`,
      placeId: placeIdOf(v.spot.id),
      name: v.spot.name,
      lat: v.spot.lat,
      lng: v.spot.lng,
      kind: v.spot === ctx.lodging ? 'lodging' : v.meal ? 'food' : 'sight',
      category: v.spot.category,
      meal: v.meal,
      night: v.spot === night,
      mustFor: ctx.members.filter((m) => marksOf(v.spot, m).some((x) => x.kind === 'must')).map((m) => m.memberId),
      likedBy: ctx.members.filter((m) => marksOf(v.spot, m).some((x) => x.kind === 'like')).map((m) => m.memberId),
      moveFromPrev: legs[k],
    };
  });
  const known = legs.filter((l): l is MoveLeg => l !== null);
  const moveMinutes = known.reduce((acc, l) => acc + (l.minutes ?? 0), 0);
  return {
    day: i + 1,
    date,
    stops,
    summary: {
      moveMinutes,
      unknownLegs: known.filter((l) => l.minutes === null).length,
      spanMinutes: ctx.spanMinutes,
      heavy: moveMinutes > ctx.spanMinutes * SCHEDULE.heavyMoveShare,
    },
  };
}

async function buildPlan(ctx: Ctx, st: PlanState, planId: string, version = 1): Promise<PlanProposal> {
  const route: PlanDay[] = [];
  for (let i = 0; i < ctx.dates.length; i++) route.push(await buildDay(ctx, st, i));
  const unknown = route.flatMap((d) => d.stops.flatMap((s) => (s.moveFromPrev?.source === 'estimate' ? [s.moveFromPrev] : [])));
  const failed = unknown.filter((l) => l.note === UNAVAILABLE).length;
  if (failed) st.notes.push(`길찾기 정보 없는 구간 ${failed}개 (카카오 한도·오류·교통 장애) — 직선거리만 표시`);
  if (unknown.length > failed) st.notes.push(`카카오가 경로를 찾지 못한 구간 ${unknown.length - failed}개 — 직선거리만 표시`);
  for (const d of route.filter((x) => x.summary.heavy)) st.notes.push(`${d.day}일째 이동 ${d.summary.moveMinutes}분 — 하루 시간의 ${Math.round(SCHEDULE.heavyMoveShare * 100)}%를 넘음`);
  return {
    planId,
    version,
    label: st.label,
    moveMode: ctx.moveMode,
    lodging: ctx.lodging ? { placeId: placeIdOf(ctx.lodging.id), name: ctx.lodging.name } : null,
    route,
    notes: st.notes,
  };
}

/** 6·9단계 입력 (회의 상태에서 그대로) */
export interface ScheduleInput {
  meetingId: string | null;
  pool: RetrieveResult;
  board: Board;
  members: readonly MemberInput[];
  decision: ReviewDecision | null;
  moveMode: MoveMode;
}

/**
 * 동선 재료와 규칙을 모음 (6단계와 9단계 수정이 같이 씀, 같은 입력이면 언제나 같은 재료): 후보·보드 점수, DB 보충 식당, 숙소, 하루 장소 수, 끼니, 야경, 이동 상한
 * 외부 호출은 없음 (DB만 읽음, 카카오는 짤 때 router로)
 */
async function contextOf(db: Db, router: RouteClient, input: ScheduleInput): Promise<{ ctx: Ctx; extras: Spot[] }> {
  const { pool, members } = input;
  // DB에서 원문을 더 읽는 후보: 분류 코드·휴무일 칸이 생기기 전(10/23 전)에 시작한 회의의 후보(사람 확인을 기다리다 이어지는 회의),
  // 영업시간을 구간으로 읽지 못한 행사(예: 드론쇼 '19:00, 21:00') — 저녁 뒤에 둘지 봄
  const missing = [...pool.candidates, ...pool.lodgings].filter((c) => c.code === undefined || (c.type === RETRIEVE.festivalType && !c.open)).map((c) => c.id);
  const filled = new Map(
    missing.length
      ? (await db.select({ id: places.contentId, code: places.lcls3, introRaw: places.introRaw }).from(places).where(inArray(places.contentId, missing))).map((r) => [
          r.id,
          { code: r.code, rest: intro(r.introRaw, ...REST_KEYS), hours: intro(r.introRaw, ...HOURS_KEYS) },
        ])
      : [],
  );
  const start = Math.max(...members.map((m) => toMinutes(m.profile.startTime)));
  let end = Math.min(...members.map((m) => toMinutes(m.profile.endTime ?? REACT.dayEnd)));
  if (end <= start) end += DAY;
  const dinner = end > DINNER_START;
  const all = spotsOf(pool, input.board, members, input.decision, filled);
  // 하루가 저녁 전에 끝나면 밤 행사·야시장은 갈 수 없어 넣지 않음
  const spots = all.spots.filter((p) => p.meal || dinner || !p.evening);
  const lodgings = all.lodgings;
  const extras = await moreRestaurants(db, pool, members);
  const attractions = spots.filter((p) => !p.meal);
  const meals = [...spots.filter((p) => p.meal), ...extras];
  // 숙소: 누군가의 꼭 지킬 곳 → 고른 AI가 많은 곳 → 보드 관광지 가운데에서 가까운 곳 (5단계에서 사람이 뺀 곳은 없음)
  const boardCenter = centerOf(attractions.filter((p) => p.proposed > 0));
  const lodging =
    pool.nights > 0
      ? ([...lodgings].sort(
          (a, b) => Number(b.must) - Number(a.must) || b.proposed - a.proposed || (boardCenter ? distanceKm(boardCenter, a) - distanceKm(boardCenter, b) : 0) || a.id.localeCompare(b.id),
        )[0] ?? null)
      : null;
  const pace = members.map((m) => (m.profile.placesPerDay[0] + m.profile.placesPerDay[1]) / 2);
  const [lo, hi] = SCHEDULE.perDayRange;
  const perDay = Math.max(lo, Math.min(hi, Math.round(pace.reduce((a, b) => a + b, 0) / Math.max(1, pace.length))));
  const center = centerOf(attractions);
  const limits = members.map((m) => m.profile.maxMoveMinutes).filter((v): v is number => v !== null);
  const ctx: Ctx = {
    members,
    dates: pool.dates,
    attractions,
    meals,
    everywhere: [...spots, ...extras],
    lodging,
    perDay,
    lunch: start < toMinutes(SCHEDULE.meals.lunch[1]),
    dinner,
    dusks: pool.dates.map((d) => (center ? duskKst(center, d, SCHEDULE.night.zenith) : null)),
    nightLovers: members.filter((m) => m.likes.includes(SCHEDULE.night.like)).length,
    moveLimit: limits.length ? Math.min(...limits) : null,
    spanMinutes: end - start,
    center,
    moveMode: input.moveMode,
    router,
    kept: new Set((input.decision?.kept ?? []).map((id) => id.replace(/^plc_/, ''))),
  };
  return { ctx, extras };
}

const planIdOf = (meetingId: string | null, label: 'A' | 'B') => `${meetingId ? meetingId.replace(/^mtg_/, 'pln_') : 'pln'}_${label.toLowerCase()}`;
const rawId = (placeId: string) => placeId.replace(/^plc_/, '');
const stopIds = (plan: PlanProposal, kind?: PlanStop['kind']) => plan.route.flatMap((d) => d.stops.filter((s) => !kind || s.kind === kind).map((s) => rawId(s.placeId)));
const fresh = (label: 'A' | 'B', sets: Spot[][], banned: Set<string> = new Set(), keep: Set<string> = new Set(), frozen: Set<number> = new Set()): PlanState => ({
  label,
  sets,
  usedMeals: new Set(),
  softMeals: new Set(),
  banned,
  keep,
  frozen,
  orders: [],
  mealPins: [],
  notes: [],
});
const setsOf = (st: PlanState, shared: readonly string[]): PlanSets => ({
  sets: st.sets.map((d) => d.map((p) => p.id)),
  banned: [...st.banned],
  shared: [...shared],
  ...(st.orders.some((o) => o) ? { orders: st.orders } : {}),
  ...(st.mealPins.some((m) => m && (m.lunch || m.dinner)) ? { mealPins: st.mealPins } : {}),
});

/** 두 안에 들어간 DB 보충 식당을 후보와 같은 꼴로 넘김 (7단계가 꼭 지킬 것·좋아요 표시와 영업시간을 봄, 10/28 점검: 표시를 못 봐 '못 지킴'으로 셈) */
function extrasIn(plans: readonly PlanProposal[], extras: readonly Spot[], pool: RetrieveResult): Candidate[] {
  const inPool = new Set([...pool.candidates, ...pool.lodgings].map((c) => c.id));
  const used = new Set(plans.flatMap((p) => stopIds(p)));
  return extras
    .filter((p) => used.has(p.id) && !inPool.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      category: p.category,
      popularity: null,
      crowd: null,
      hours: null,
      open: p.open,
      restUnknown: false,
      code: p.code,
      rest: p.rest,
      summary: '',
      menu: null,
      lat: p.lat,
      lng: p.lng,
      scores: {},
      total: 0,
      reasons: {},
      marks: p.marks,
      forMembers: [],
    }));
}

/**
 * 6단계 동선 짜기 (코드, LLM 0회): 4단계 반응·5단계 사람 확인을 반영한 재료로 A·B 두 안을 짬
 * A안: 꼭 지킬 곳 → 점수·가까움으로 날마다 채움. B안: 꼭 지킬 곳과 A안의 1순위(꼭 지킬 곳이 아닌 곳 중 점수 1위)는 같이 쓰고 나머지는 A안과 겹치지 않게 (10/19 사용자 결정)
 * 외부 호출은 router(카카오 길찾기)뿐이며 식당 보충은 DB만 읽음. states는 9단계 수정이 이어서 쓰는 두 안의 재료(id)
 */
export async function schedulePlans(db: Db, router: RouteClient, input: ScheduleInput): Promise<{ plans: PlanProposal[]; extras: Candidate[]; states: PlanStates }> {
  const { ctx, extras } = await contextOf(db, router, input);
  const required = requiredPlaces(ctx, new Set());
  const stA = fresh('A', pickSets(ctx, new Set(), required));
  const A = await buildPlan(ctx, stA, planIdOf(input.meetingId, 'A'));
  const aStops = A.route.flatMap((d) => d.stops);
  const byId = new Map(ctx.everywhere.map((p) => [p.id, p]));
  const top = byPrio(aStops.filter((s) => s.kind === 'sight').map((s) => byId.get(rawId(s.placeId))).filter((p): p is Spot => !!p && !p.must))[0];
  const shared = [...required, ...(top ? [top] : [])];
  const sharedIds = new Set(shared.map((p) => p.id));
  const avoid = new Set(aStops.map((s) => rawId(s.placeId)).filter((id) => !sharedIds.has(id)));
  const stB = fresh('B', pickSets(ctx, avoid, shared));
  stB.softMeals = new Set(stopIds(A, 'food').filter((id) => !sharedIds.has(id)));
  const B = await buildPlan(ctx, stB, planIdOf(input.meetingId, 'B'));
  return { plans: [A, B], extras: extrasIn([A, B], extras, input.pool), states: { A: setsOf(stA, []), B: setsOf(stB, [...sharedIds]) } };
}

/** 9단계 수정 한 건 (7·11단계 요청을 코드가 확인한 값, 장소는 plc_ id). move의 placeId는 그 긴 이동을 줄이려 뺄 곳 (없으면 반영하지 못함) */
export interface PlanEdit {
  plan: 'A' | 'B';
  type: 'include' | 'avoid' | 'replace' | 'move';
  placeId: string | null;
  toId: string | null;
}
/** 수정 한 건의 결과. note는 코드가 쓴 글 (바뀐 것 또는 반영하지 못한 까닭) */
export interface EditResult {
  plan: 'A' | 'B';
  applied: boolean;
  note: string;
}

/** 수정을 반영하지 못한 까닭 (코드 문장) */
const SKIP = {
  cap: '이번 라운드에 바꿀 수 있는 수를 다 씀',
  again: '이번 라운드에 이미 바꾼 곳',
  fixed: '바꿀 수 없는 곳 (숙소·사람이 남긴 곳·그 꼭 지킬 것을 채우는 하나뿐인 곳)',
  missing: '지금 일정에 없는 곳',
  present: '이미 일정에 있는 곳',
  unusable: '일정에 넣을 수 없는 곳',
  closed: '여행 날짜에 모두 쉬는 곳',
  full: '그날 대신 뺄 수 있는 곳이 없음',
  noMeal: '끼니 시간이 없는 일정',
  minimum: '하루 최소 장소 수',
  noMove: '줄일 수 있는 이동이 없음',
} as const;

/** 수정 중인 한 안: 날마다 넣은 곳, 뺀 곳, 지금 안의 끼니 식당(짤 때 고른 곳)과 이번 라운드에 바꾼 수·곳·날, 요청대로 넣은 곳 */
interface Work {
  sets: Spot[][];
  banned: Set<string>;
  meals: { id: string; day: number }[];
  count: number;
  touched: Set<string>;
  days: Set<number>;
  requested: Set<string>;
  notes: string[];
}

/**
 * 9단계 수정 (코드, LLM 0회): 받은 순서대로 요청을 반영하고 바뀐 안만 6단계 계산(순서·끼니·카카오 길찾기)으로 다시 짬 (같은 planId, version + 1)
 * 반영 규칙 (10/17 시험판, 10/29 사용자 승인): 넣기는 그곳이 여는 날 중 그날 장소들과 가까운 날에, 그날이 다 찼으면 AI가 덜 고르고 점수가 낮은 곳과 바꿈 ·
 * 빼기는 다시 넣지 않게 표시하고 그날이 모자라면 6단계와 같은 묶음 값으로 채움 (끼니 식당은 다른 식당으로) · 바꾸기는 뺀 날에 넣음 ·
 * 긴 이동 줄이기는 그곳을 빼고 그날 가운데에 더 가까운 곳이 있을 때만 채움 · 빼기·긴 이동 줄이기는 채울 곳이 없으면 하루 최소 장소 수 아래로 빼지 않음
 * 바꿀 수 없는 곳은 앞서 반영한 수정까지 본 지금 안으로 다시 확인함: 숙소 · 5단계에서 사람이 남긴 곳 · 그 사람의 꼭 지킬 것을 채우는 곳이 그 안에 그곳뿐
 * 안마다 한 라운드에 changesPerPlan개까지, 한 라운드에 같은 곳은 한 번만 바꿈
 */
export async function revisePlans(
  db: Db,
  router: RouteClient,
  input: ScheduleInput,
  current: { plans: readonly PlanProposal[]; states: PlanStates },
  edits: readonly PlanEdit[],
  opts: { changesPerPlan: number },
): Promise<{ plans: PlanProposal[]; states: PlanStates; extras: Candidate[]; results: EditResult[]; changed: ('A' | 'B')[] }> {
  const { ctx, extras } = await contextOf(db, router, input);
  const byId = new Map([...ctx.everywhere, ...(ctx.lodging ? [ctx.lodging] : [])].map((p) => [p.id, p]));
  const kept = new Set(input.decision?.kept ?? []);
  const labels = ['A', 'B'] as const;
  const planOf = (l: 'A' | 'B') => current.plans.find((p) => p.label === l)!;
  const work: Record<'A' | 'B', Work> = {
    A: workOf('A'),
    B: workOf('B'),
  };
  function workOf(l: 'A' | 'B'): Work {
    const saved = current.states[l];
    return {
      sets: ctx.dates.map((_, d) => (saved.sets[d] ?? []).map((id) => byId.get(id)).filter((p): p is Spot => !!p)),
      banned: new Set(saved.banned),
      meals: planOf(l).route.flatMap((day) => day.stops.filter((s) => s.kind === 'food').map((s) => ({ id: rawId(s.placeId), day: day.day - 1 }))),
      count: 0,
      touched: new Set(),
      days: new Set(),
      requested: new Set(),
      notes: [],
    };
  }
  const mealsPerDay = Number(ctx.lunch) + Number(ctx.dinner);
  const home = ctx.lodging ? [ctx.lodging] : [];
  const openOn = (p: Spot, d: number) => closedOn(p.rest, ctx.dates[d]) !== 'closed';
  const fans = (q: Spot) => ctx.members.filter((m) => marksOf(q, m).some((k) => k.kind === 'like')).length;
  const mustKeys = (p: Spot) => Object.entries(p.marks).flatMap(([memberId, ks]) => ks.filter((k) => k.kind === 'must').map((k) => `${memberId}\n${k.label}`));
  const dayIn = (w: Work, id: string) => w.sets.findIndex((x) => x.some((p) => p.id === id));
  const mealIn = (w: Work, id: string) => (w.banned.has(id) ? undefined : w.meals.find((x) => x.id === id));
  const inPlan = (w: Work, id: string) => dayIn(w, id) >= 0 || !!mealIn(w, id);
  // 꼭 지킬 것을 채운다고 세는 곳은 날마다 넣은 곳뿐 (짤 때 고르는 끼니 식당은 다시 짜면 바뀔 수 있음, 10/29 점검)
  const fixedNow = (w: Work, p: Spot) => {
    if (p === ctx.lodging || kept.has(placeIdOf(p.id))) return true;
    const others = w.sets.flat().filter((q) => q.id !== p.id);
    return mustKeys(p).some((key) => !others.some((q) => mustKeys(q).includes(key)));
  };
  /** 그곳이 여는 날을 그날 장소들과 가까운 순으로 */
  const nearDays = (w: Work, p: Spot) =>
    ctx.dates
      .map((_, d) => d)
      .filter((d) => openOn(p, d))
      .map((d) => ({ d, km: w.sets[d].length ? Math.min(...w.sets[d].map((q) => distanceKm(q, p))) : 0 }))
      .sort((a, b) => a.km - b.km || a.d - b.d)
      .map((x) => x.d);
  const insert = (w: Work, p: Spot, prefer: number | null): { day: number; dropped: Spot | null } | keyof typeof SKIP => {
    if (p.meal && mealsPerDay === 0) return 'noMeal';
    const near = nearDays(w, p);
    if (!near.length) return 'closed';
    for (const d of prefer !== null && near.includes(prefer) ? [prefer, ...near.filter((x) => x !== prefer)] : near) {
      const same = w.sets[d].filter((q) => q.meal === p.meal);
      if (same.length < (p.meal ? mealsPerDay : ctx.perDay)) {
        w.sets[d] = [...w.sets[d], p];
        return { day: d, dropped: null };
      }
      // 이번 라운드에 넣은 곳은 다시 빼지 않음 (바꾸기로 넣은 곳이 뒤의 넣기에 밀려나지 않게)
      // 밀려나는 곳: AI가 덜 고른 곳 → 점수(반응·좋아요·인기도)가 낮은 곳 → 좋아하는 사람이 적은 곳 (10/29 검증29: 좋아요가 분류 코드로만 잡혀 광안대교·안목해변 같은 명소가 먼저 밀려남)
      const out = same
        .filter((q) => !q.must && !w.touched.has(q.id) && !fixedNow(w, q))
        .sort((a, b) => a.proposed - b.proposed || a.prio - b.prio || fans(a) - fans(b) || a.id.localeCompare(b.id))[0];
      if (out) {
        w.sets[d] = [...w.sets[d].filter((q) => q.id !== out.id), p];
        return { day: d, dropped: out };
      }
    }
    return 'full';
  };
  /** 빼기: 날마다 넣은 곳에서 지우고 이 안에서 다시 쓰지 않음. 짤 때 고른 끼니 식당이면 그 자리에 다른 식당이 들어감 */
  const remove = (w: Work, p: Spot) => {
    const d = dayIn(w, p.id);
    const meal = mealIn(w, p.id);
    if (d >= 0) w.sets[d] = w.sets[d].filter((q) => q.id !== p.id);
    w.banned.add(p.id);
    return d >= 0 ? d : (meal?.day ?? 0);
  };
  /**
   * 채우기: 그날 여는, 이 안에 없고 뺀 적 없고 이번 라운드에 바꾼 적 없는 관광지 중 6단계 묶음 값(점수 − 가운데에서 거리 − 같은 소분류)이 가장 큰 곳
   * 다른 안에 있는 곳(같이 쓰는 곳 빼고)은 다른 곳이 없을 때만 (B안이 채우기로 A안을 닮아 가지 않게, 6단계 pickSets와 같은 잣대)
   * closerThan(긴 이동 줄이기)이 있으면 그곳보다 그날 가운데에 가까운 곳만, 다른 안의 곳은 쓰지 않음 (이동만 줄이면 되므로 채우지 않아도 됨)
   */
  const shared = new Set(current.states.B.shared);
  const refill = (l: 'A' | 'B', d: number, closerThan: Spot | null = null) => {
    const w = work[l];
    const c = centerOf([...w.sets[d], ...home]);
    const chosen = w.sets.flat();
    const used = new Set(chosen.map((q) => q.id));
    const other = new Set(work[l === 'A' ? 'B' : 'A'].sets.flat().map((q) => q.id).filter((id) => !shared.has(id)));
    const value = (p: Spot) =>
      p.prio - SCHEDULE.distPenaltyPerKm * (c ? distanceKm(c, p) : 0) - SCHEDULE.sameKindPenalty * chosen.filter((q) => kindOf(q) !== null && kindOf(q) === kindOf(p)).length;
    const ok = ctx.attractions
      .filter((p) => !used.has(p.id) && !w.banned.has(p.id) && !w.touched.has(p.id) && openOn(p, d) && (!closerThan || !c || distanceKm(c, p) < distanceKm(c, closerThan)))
      .sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id));
    return ok.find((p) => !other.has(p.id)) ?? (closerThan ? null : ok[0]) ?? null;
  };
  const attractionsOn = (w: Work, d: number) => w.sets[d].filter((q) => !q.meal).length;

  const results: EditResult[] = [];
  for (const e of edits) {
    const w = work[e.plan];
    const skip = (why: keyof typeof SKIP) => results.push({ plan: e.plan, applied: false, note: `${e.plan}안 반영 못 함: ${SKIP[why]}` });
    const done = (note: string, days: number[], ...spots: (Spot | null)[]) => {
      w.count++;
      for (const x of spots) if (x) w.touched.add(x.id);
      for (const d of days) w.days.add(d);
      w.notes.push(note);
      results.push({ plan: e.plan, applied: true, note: `${e.plan}안 ${note}` });
    };
    if (w.count >= opts.changesPerPlan) {
      skip('cap');
      continue;
    }
    const p = e.placeId ? (byId.get(rawId(e.placeId)) ?? null) : null;
    const to = e.toId ? (byId.get(rawId(e.toId)) ?? null) : null;
    if ([p, to].some((x) => x && w.touched.has(x.id))) {
      skip('again');
      continue;
    }
    // 실패하면 이 수정 전으로 되돌림 (빼고 넣는 두 걸음 중 넣기가 막힐 때)
    const snapshot = { sets: w.sets.map((x) => x.slice()), banned: new Set(w.banned) };
    const undo = (why: keyof typeof SKIP) => {
      w.sets = snapshot.sets;
      w.banned = snapshot.banned;
      skip(why);
    };
    if (e.type === 'include') {
      if (!p || p === ctx.lodging) skip('unusable');
      else if (inPlan(w, p.id)) skip('present');
      else {
        const r = insert(w, p, null);
        if (typeof r === 'string') skip(r);
        else {
          w.banned.delete(p.id);
          w.requested.add(p.id);
          done(`${r.day + 1}일째 ${p.name} 넣음${r.dropped ? ` (${r.dropped.name} 뺌)` : ''}`, [r.day], p, r.dropped);
        }
      }
      continue;
    }
    if (p && p === ctx.lodging) {
      skip('fixed');
      continue;
    }
    if (!p || !inPlan(w, p.id)) {
      skip(e.type === 'move' && !e.placeId ? 'noMove' : 'missing');
      continue;
    }
    if (fixedNow(w, p)) {
      skip('fixed');
      continue;
    }
    // 빼기·바꾸기·긴 이동 줄이기는 그날 관광지가 하루 최소 장소 수 아래로 줄어들면 반영하지 않음 (처음부터 적었던 날은 더 줄지만 않으면 됨)
    const shrinks = (d: number, before: number) => attractionsOn(w, d) < SCHEDULE.perDayRange[0] && attractionsOn(w, d) < before;
    if (e.type === 'avoid') {
      const d0 = dayIn(w, p.id);
      const before = d0 >= 0 ? attractionsOn(w, d0) : 0;
      const d = remove(w, p);
      if (p.meal) {
        done(`${d + 1}일째 ${p.name} 대신 다른 식당`, [d], p);
        continue;
      }
      const inn = attractionsOn(w, d) < ctx.perDay ? refill(e.plan, d) : null;
      if (inn) w.sets[d] = [...w.sets[d], inn];
      if (shrinks(d, before)) undo('minimum');
      else done(`${d + 1}일째 ${p.name} 뺌${inn ? ` → ${inn.name}` : ''}`, [d], p, inn);
    } else if (e.type === 'replace') {
      if (!to || to === ctx.lodging) skip('unusable');
      else if (inPlan(w, to.id)) skip('present');
      else {
        const d0 = dayIn(w, p.id);
        const before = d0 >= 0 ? attractionsOn(w, d0) : 0;
        const d = remove(w, p);
        const r = insert(w, to, d);
        if (typeof r === 'string') undo(r);
        else if (shrinks(d, before)) undo('minimum');
        else {
          w.banned.delete(to.id);
          w.requested.add(to.id);
          done(`${d + 1}일째 ${p.name} → ${to.name}${r.day !== d ? ` (${r.day + 1}일째)` : ''}${r.dropped ? ` (${r.dropped.name} 뺌)` : ''}`, [d, r.day], p, to, r.dropped);
        }
      }
    } else {
      // move: 긴 이동 끝의 관광지를 빼고, 그날 가운데에 더 가까운 곳이 있으면 그곳으로 채움
      const d = dayIn(w, p.id);
      if (p.meal || d < 0) {
        skip('noMove');
        continue;
      }
      const before = attractionsOn(w, d);
      remove(w, p);
      const inn = refill(e.plan, d, p);
      if (inn) w.sets[d] = [...w.sets[d], inn];
      if (shrinks(d, before)) undo('minimum');
      else done(`${d + 1}일째 긴 이동을 줄이려 ${p.name} 뺌${inn ? ` → ${inn.name}` : ''}`, [d], p, inn);
    }
  }

  // 바뀐 안만 다시 짬 (A 먼저: B안은 새 A안의 식당을 되도록 피함). 바뀌지 않은 구간의 길찾기는 저장된 것을 씀
  const changed = labels.filter((l) => work[l].count > 0);
  const plans = new Map(current.plans.map((p) => [p.label, p]));
  const states: PlanStates = { ...current.states };
  for (const l of changed) {
    const frozen = new Set(ctx.dates.map((_, d) => d).filter((d) => !work[l].days.has(d)));
    const st = fresh(l, work[l].sets, work[l].banned, new Set([...work[l].requested].filter((id) => !work[l].banned.has(id))), frozen);
    if (l === 'B') st.softMeals = new Set(stopIds(plans.get('A')!, 'food').filter((id) => !current.states.B.shared.includes(id)));
    const old = planOf(l);
    plans.set(l, { ...(await buildPlan(ctx, st, old.planId, old.version + 1)), changes: work[l].notes });
    states[l] = setsOf(st, current.states[l].shared);
  }
  const out = labels.map((l) => plans.get(l)!);
  return { plans: out, states, extras: extrasIn(out, extras, input.pool), results, changed };
}

/**
 * 14단계 사람 고치기 한 건 (사람이 화면에서 고른 값만: 일정 항목 id·장소 id·날짜 번호, 글은 받지 않음)
 * remove 빼기 (끼니 식당이면 그 자리에 다른 식당) · add 넣기 (관광지, day는 0부터) · move 다른 날로 옮기기 · reorder 그날 관광지 순서 · meal 끼니 식당 바꾸기 (placeId 없으면 다른 식당)
 */
export type HumanEdit =
  | { type: 'remove'; itemId: string }
  | { type: 'add'; placeId: string; day: number }
  | { type: 'move'; itemId: string; day: number }
  | { type: 'reorder'; day: number; itemIds: string[] }
  | { type: 'meal'; itemId: string; placeId: string | null };

/** 사람 고치기를 반영하지 못한 까닭 (코드 문장) */
const HUMAN_SKIP = {
  missing: '지금 일정에 없는 항목',
  lodging: '숙소는 여기서 바꿀 수 없음',
  unusable: '넣을 수 없는 곳',
  present: '이미 일정에 있는 곳',
  day: '여행 날짜에 없는 날',
  closed: '그날 쉬는 곳',
  notSight: '관광지만 옮기거나 순서를 바꿀 수 있음',
  notMeal: '끼니 식당이 아님',
  order: '그날 관광지를 모두 한 번씩 적어야 함',
  mealClosed: '그 끼니 시간에 열지 않거나 그날 쉬는 식당',
  same: '이미 그날에 있음',
} as const;

/**
 * 14단계 사람 고치기 (코드, LLM 0회): 사람이 고른 대로 바꾸고 고른 안을 6단계 계산으로 다시 짬 (같은 planId, version + 1)
 * 최종 결정은 사람이라 꼭 지킬 곳·사람이 남긴 곳도 뺄 수 있고, 이동 상한 고치기로 자동으로 빼지 않음. 사람이 정한 순서·고른 식당은 그대로 둠
 * 구간 가는 길은 바뀐 구간만 카카오에 물음 (같은 구간은 저장된 것)
 */
export async function editPlan(
  db: Db,
  router: RouteClient,
  input: ScheduleInput,
  current: { plan: PlanProposal; state: PlanSets },
  edits: readonly HumanEdit[],
): Promise<{ plan: PlanProposal; state: PlanSets; results: EditResult[] }> {
  const { ctx } = await contextOf(db, router, input);
  const label = current.plan.label;
  const byId = new Map([...ctx.everywhere, ...(ctx.lodging ? [ctx.lodging] : [])].map((p) => [p.id, p]));
  const D = ctx.dates.length;
  const sets = ctx.dates.map((_, d) => (current.state.sets[d] ?? []).map((id) => byId.get(id)).filter((p): p is Spot => !!p));
  const banned = new Set(current.state.banned);
  const orders: (string[] | null)[] = ctx.dates.map((_, d) => current.state.orders?.[d] ?? null);
  const mealPins: MealPins[] = ctx.dates.map((_, d) => ({ ...(current.state.mealPins?.[d] ?? {}) }));
  const stops = new Map(current.plan.route.flatMap((day, d) => day.stops.map((x) => [x.itemId, { stop: x, day: d }] as const)));
  const openOn = (p: Spot, d: number) => closedOn(p.rest, ctx.dates[d]) !== 'closed';
  const dayOf = (id: string) => sets.findIndex((x) => x.some((p) => p.id === id));
  const inPlan = (id: string) => dayOf(id) >= 0 || current.plan.route.some((day) => day.stops.some((x) => rawId(x.placeId) === id && !banned.has(id)));
  const unpin = (d: number, id: string) => {
    if (orders[d]) orders[d] = orders[d]!.filter((x) => x !== id);
  };
  const results: EditResult[] = [];
  const notes: string[] = [];
  for (const e of edits) {
    const skip = (why: keyof typeof HUMAN_SKIP) => results.push({ plan: label, applied: false, note: `반영 못 함: ${HUMAN_SKIP[why]}` });
    const done = (note: string) => {
      notes.push(note);
      results.push({ plan: label, applied: true, note });
    };
    if (e.type === 'add') {
      const p = byId.get(rawId(e.placeId));
      if (!p || p.meal || p === ctx.lodging || !ctx.attractions.includes(p)) skip('unusable');
      else if (inPlan(p.id)) skip('present');
      else if (!(e.day >= 0 && e.day < D)) skip('day');
      else if (!openOn(p, e.day)) skip('closed');
      else {
        sets[e.day] = [...sets[e.day], p];
        banned.delete(p.id);
        if (orders[e.day]) orders[e.day] = [...orders[e.day]!, p.id];
        done(`${e.day + 1}일째 ${p.name} 넣음`);
      }
      continue;
    }
    if (e.type === 'reorder') {
      if (!(e.day >= 0 && e.day < D)) {
        skip('day');
        continue;
      }
      const sights = current.plan.route[e.day]?.stops.filter((x) => x.kind === 'sight') ?? [];
      const ids = e.itemIds.map((itemId) => stops.get(itemId)).filter((x) => x && x.day === e.day && x.stop.kind === 'sight').map((x) => rawId(x!.stop.placeId));
      if (ids.length !== e.itemIds.length || new Set(ids).size !== sights.length || ids.length !== sights.length) skip('order');
      else {
        orders[e.day] = ids;
        done(`${e.day + 1}일째 관광지 순서 바꿈`);
      }
      continue;
    }
    const found = stops.get(e.itemId);
    if (!found) {
      skip('missing');
      continue;
    }
    const { stop, day: d0 } = found;
    const id = rawId(stop.placeId);
    if (stop.kind === 'lodging') {
      skip('lodging');
      continue;
    }
    if (e.type === 'remove') {
      if (stop.kind === 'food') {
        banned.add(id);
        const k = dayOf(id);
        if (k >= 0) sets[k] = sets[k].filter((p) => p.id !== id);
        if (stop.meal && mealPins[d0][stop.meal] === id) delete mealPins[d0][stop.meal];
        done(`${d0 + 1}일째 ${stop.name} 대신 다른 식당`);
      } else {
        const k = dayOf(id);
        if (k >= 0) sets[k] = sets[k].filter((p) => p.id !== id);
        banned.add(id);
        unpin(d0, id);
        done(`${d0 + 1}일째 ${stop.name} 뺌`);
      }
    } else if (e.type === 'move') {
      const p = byId.get(id);
      const k = dayOf(id);
      if (stop.kind !== 'sight' || !p || k < 0) skip('notSight');
      else if (!(e.day >= 0 && e.day < D)) skip('day');
      else if (!openOn(p, e.day)) skip('closed');
      else if (e.day === k) skip('same');
      else {
        sets[k] = sets[k].filter((q) => q.id !== id);
        sets[e.day] = [...sets[e.day], p];
        unpin(k, id);
        if (orders[e.day]) orders[e.day] = [...orders[e.day]!, id];
        done(`${stop.name} ${k + 1}일째 → ${e.day + 1}일째`);
      }
    } else {
      // meal: 그 끼니 자리의 식당을 바꿈 (고른 식당은 그 끼니 시간에 열고 그날 쉬지 않아야 함)
      if (stop.kind !== 'food' || !stop.meal) {
        skip('notMeal');
        continue;
      }
      const slot = stop.meal;
      const [w0, w1] = SCHEDULE.meals[slot].map(toMinutes);
      const next = e.placeId ? byId.get(rawId(e.placeId)) : undefined;
      if (e.placeId && (!next || !next.meal || next.id === id)) skip('unusable');
      else if (next && (closedOn(next.rest, ctx.dates[d0]) === 'closed' || (next.open && overlapMinutes(next.open, w0, w1) <= 0))) skip('mealClosed');
      else {
        banned.add(id);
        const k = dayOf(id);
        if (k >= 0) sets[k] = sets[k].filter((p) => p.id !== id);
        if (next) {
          mealPins[d0][slot] = next.id;
          banned.delete(next.id);
          done(`${d0 + 1}일째 ${SLOT_LABEL[slot]} ${stop.name} → ${next.name}`);
        } else {
          delete mealPins[d0][slot];
          done(`${d0 + 1}일째 ${SLOT_LABEL[slot]} ${stop.name} 대신 다른 식당`);
        }
      }
    }
  }
  if (!notes.length) return { plan: current.plan, state: current.state, results };
  // 다시 짬: 사람이 고친 안이라 이동 상한 고치기를 하지 않음 (모든 날 frozen), 사람이 정한 순서·식당은 그대로
  const st = fresh(label, sets, banned, new Set(sets.flat().map((p) => p.id)), new Set(ctx.dates.map((_, d) => d)));
  st.orders = orders;
  st.mealPins = mealPins;
  const plan = { ...(await buildPlan(ctx, st, current.plan.planId, current.plan.version + 1)), changes: notes };
  return { plan, state: setsOf(st, current.state.shared), results };
}

/** 14단계 보기: 넣을 수 있는 관광지(일정에 없는 곳, 점수 순)와 끼니 식당마다 바꿀 수 있는 식당(그날 그 끼니에 열고, 동선에서 덜 벗어나고 점수가 큰 순) */
export async function editOptions(
  db: Db,
  input: ScheduleInput,
  plan: PlanProposal,
  limits: { sights: number; meals: number },
): Promise<{ sights: { placeId: string; name: string; category: string | null; lat: number; lng: number; likedBy: string[]; mustFor: string[]; closedDays: number[] }[]; meals: Record<string, { placeId: string; name: string; category: string | null; detourKm: number }[]> }> {
  const { ctx } = await contextOf(db, { car: async () => null, transit: async () => null, walk: async () => null }, input);
  const used = new Set(plan.route.flatMap((d) => d.stops.map((x) => rawId(x.placeId))));
  const who = (p: Spot, kind: Mark['kind']) => ctx.members.filter((m) => marksOf(p, m).some((k) => k.kind === kind)).map((m) => m.memberId);
  const sights = byPrio(ctx.attractions.filter((p) => !used.has(p.id)))
    .slice(0, limits.sights)
    .map((p) => ({
      placeId: placeIdOf(p.id),
      name: p.name,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      likedBy: who(p, 'like'),
      mustFor: who(p, 'must'),
      closedDays: ctx.dates.map((d, i) => (closedOn(p.rest, d) === 'closed' ? i : -1)).filter((i) => i >= 0),
    }));
  const meals: Record<string, { placeId: string; name: string; category: string | null; detourKm: number }[]> = {};
  plan.route.forEach((day, d) => {
    day.stops.forEach((x, k) => {
      if (x.kind !== 'food' || !x.meal) return;
      const [w0, w1] = SCHEDULE.meals[x.meal].map(toMinutes);
      const prev = day.stops[k - 1] ?? null;
      const next = day.stops[k + 1] ?? null;
      const km = (r: Spot) => (prev && next ? distanceKm(prev, r) + distanceKm(r, next) - distanceKm(prev, next) : distanceKm(prev ?? next ?? r, r));
      meals[x.itemId] = ctx.meals
        .filter((r) => !used.has(r.id) && closedOn(r.rest, ctx.dates[d]) !== 'closed' && (!r.open || overlapMinutes(r.open, w0, w1) > 0))
        .map((r) => ({ r, v: km(r) - SCHEDULE.mealPrioPerKm * r.prio }))
        .sort((a, b) => a.v - b.v || a.r.id.localeCompare(b.r.id))
        .slice(0, limits.meals)
        .map(({ r }) => ({ placeId: placeIdOf(r.id), name: r.name, category: r.category, detourKm: Math.round(km(r) * 10) / 10 }));
    });
  });
  return { sights, meals };
}

