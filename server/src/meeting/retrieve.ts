import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, places, regions } from '../db/schema.js';
import { todayKst } from '../lib/time.js';
import type { MustKeepRule, PersonaProfile } from '../persona/types.js';
import type { TourClient } from '../tour/client.js';
import { CANDIDATE_TYPES, LODGING_TYPE } from './categories.js';
import { crowd } from './crowd.js';
import { type OpenHours, closedOn, hoursLabel, hoursOn } from './hours.js';
import { normName } from './match.js';
import type { NameMatcher, NamePlace, NameRule } from './names.js';
import { popularity } from './popularity.js';
import { districtsNamed, shortRegionName } from './regions.js';
import { centerOf, oneWayMinutes } from './travel.js';
import { type RulePlace, dislikeMatches, dislikeText, likeMatches, likeText, ruleMatcher } from './rules.js';
import type { ResolvedDestination, TripConditions } from './types.js';

/** 후보 찾기 규칙 값 (모두 여기서만 바꿈) */
export const RETRIEVE = {
  /** 회의 후보로 쓰는 장소 유형 (목록은 categories.ts 한 곳에 둠) */
  types: CANDIDATE_TYPES,
  /** 숙박: 1박 이상일 때만, 40곳과 따로 lodgingPoolSize곳 (꼭 지킬 것에 맞는 곳 먼저 → 4명 합계 → 인기도 순) */
  lodgingType: LODGING_TYPE,
  lodgingPoolSize: 10,
  foodType: 39,
  festivalType: 15,
  /** 사람마다 자기 몫으로 몇 곳을 넣을지 (꼭 지킬 것 하나당 최대 mustKeepPerRule곳, 나머지는 좋아요 보기를 돌아가며), 전체 후보 수, 음식점 최소 수 */
  perMember: 8,
  mustKeepPerRule: 2,
  poolSize: 40,
  minFood: 6,
  /** 사람 몫이 아닌 칸을 채울 때 음식점은 이만큼까지만 (관광지와 균형) */
  maxFood: 12,
  /**
   * 점수: 좋아요 일치 1개당(최대 2개), 꼭 지킬 것, 인기도·혼잡도 최대 폭, 싫어요에 걸림
   * 근거 (10/15 민감도 실험, 여행 20개·실제 AI 카드 80장): 꼭 지킬 것·좋아요 반영은 몫 채우는 순서가 보장해 이 값을 3배 바꿔도 같음(23/23, 139/139)
   * 인기도·혼잡도 폭 ±2는 명소형·탐험형 몫의 평균 인기도 차이(31 대 9)가 가장 큰 구간이고, 0으로 끄면 차이가 뒤집힘(15 대 21)
   */
  likePoint: 3,
  likeMax: 2,
  mustKeepPoint: 10,
  popularityRange: 2,
  crowdRange: 2,
  dislikePoint: -3,
  /** 이름이 앞부분까지 같고 이 거리(m) 안이면 같은 곳으로 보고 하나만 남김 (예: 오륙도·오륙도 등대) */
  sameSpotMeters: 300,
  /** 소개글 앞부분 길이 (3단계 고르기 표에는 PICK.summaryChars까지만 넣음) */
  summaryChars: 150,
  /** 구 단위 여행에서 꼭 지킬 것(넣기)이 여행지에 없을 때 같은 시·도의 다른 구·군에서 규칙마다 넣는 곳 수 (10/16 사용자 결정) */
  outsidePerRule: 1,
  /**
   * 여행지 밖에서 넣는 곳은 여행지 가운데에서 편도 이 시간(분) 안만 (어림, travel.ts). 넘으면 넣지 않고 안건 메모만 (10/19 사용자 결정: 시간은 근거로 정함)
   * 근거: 권영현·김의준(2015, 『지역연구』 31(1), 2012 국민여행실태조사 원자료) — 국내 관광수요의 94.3%가 이동 75.1분 안에 있고
   * 75.2분부터는 5.7%로 끊김(관광효과 배제구역), 그 안의 관광객은 당일여행을 더 고름. 여행 중 여행지 밖 1곳을 다녀오는 것을 당일 나들이와 같은 범위로 봄
   * 참고: 한국관광공사(2022) 야간관광 실태조사 이동 1시간 미만 51.1%·2시간 미만 81.6%, Dijst·Vidakovic(2000) 여가 활동은 이동이 (이동+머무는 시간)의 20–30%
   */
  outsideMaxMinutes: 75,
} as const;

export interface MemberInput {
  memberId: string;
  nickname: string;
  title: string;
  likes: readonly string[];
  dislikes: readonly string[];
  mustKeep: readonly MustKeepRule[];
  profile: PersonaProfile;
  /** 15번에서 규칙으로 바꾸지 못한 바람 (3단계 고르기 LLM에 참고로 넣음) */
  wishes?: readonly string[];
  /** 성향 칩 이름 (예: 느긋형) · 구성원 색 (화면·이벤트용) */
  chips?: readonly string[];
  color?: string;
}

/**
 * 사람별 근거의 종류 (4단계 반응 판정이 문장을 해석하지 않고 이 값만 봄)
 * like 좋아요 보기 · must 꼭 지킬 것(넣기) · dislike 싫어요 보기 · crowd 혼잡 예측이 그 사람 상한을 넘음
 */
export interface Mark {
  kind: 'like' | 'must' | 'dislike' | 'crowd';
  label: string;
}

export interface Candidate {
  id: string;
  name: string;
  type: number;
  /** 공식 분류 이름 (예: 해변. 해수욕장) */
  category: string | null;
  /** 연관 관광지 순위 기반 인기도 0–100, 자료가 없으면 null (명세서 4.4 장소 JSON) */
  popularity: number | null;
  /** 여행 날짜의 집중률 예측 0–100, 30일 밖이거나 예측 대상이 아니면 null */
  crowd: number | null;
  hours: string | null;
  /** 여행 달의 영업시간 (0시부터의 분), 읽지 못했거나 정보가 없으면 null */
  open: OpenHours | null;
  /** 휴무일 문장을 읽지 못한 장소 (빼지 않고 '확인 필요'로 표시) */
  restUnknown: boolean;
  summary: string;
  /** 음식점 대표 메뉴 (상세 정보가 있을 때) */
  menu: string | null;
  lat: number | null;
  lng: number | null;
  scores: Record<string, number>;
  total: number;
  reasons: Record<string, string[]>;
  marks: Record<string, Mark[]>;
  /** 이 사람 몫으로 들어간 후보 (점수 상위 8곳) */
  forMembers: string[];
  /** 여행지 밖(같은 시·도의 다른 구·군)이면 그 시·군·구 이름: 꼭 지킬 것이 여행지에 없어 넣은 곳 */
  outside?: string;
  /** 여행지 밖이면 여행지 가운데에서 편도 어림 (분) */
  outsideMinutes?: number;
}

export interface RetrieveResult {
  destination: ResolvedDestination;
  dates: string[];
  candidates: Candidate[];
  /** LLM에 넣는 한 줄 표 (id|이름|분류|인기|혼잡|영업|요약) */
  table: string;
  /** 숙박 일수 (당일치기 0) */
  nights: number;
  /** 숙소 후보 (1박 이상일 때만, 40곳과 따로) */
  lodgings: Candidate[];
  /** 숙소 후보의 한 줄 표 (형식은 table과 같음, 당일치기면 빈 문자열) */
  lodgingTable: string;
  stages: { label: string; count: number }[];
  excluded: { reason: string; count: number; examples: string[] }[];
  popularity: { baseYm: string | null; matched: number };
  crowd: { fetched: string[]; cached: string[]; matched: number; note: string | null };
  sources: string[];
  baseDate: string;
  /** 꼭 지킬 것(넣기)이 여행지에 없고 같은 시·도의 다른 구·군에만 있는 것 (placeId: 넣은 후보 id, 지역 규칙이라 넣지 못했으면 null) */
  /** minutes: 여행지 가운데에서 편도 어림 (분). 넣은 곳은 그 곳까지, 멀어서 못 넣은 규칙은 가장 가까운 곳까지 */
  outsideRules: { memberId: string; label: string; district: string; placeId: string | null; minutes?: number }[];
  /** 이름 맞추기(LLM)로 찾은 꼭 지킬 것: 사람이 쓴 말(keyword)과 맞춘 장소 이름·id (보드에 오르면 5단계 사람 확인 안건) */
  nameMatches: { memberId: string; label: string; keyword: string; places: string[]; ids: string[] }[];
  /** 꼭 지킬 것(넣기)인데 후보에 하나도 없는 것과 그 까닭 (여행지 밖 메모가 있는 것은 빼고) */
  missingRules: { memberId: string; label: string; reason: string }[];
}

const DAY_MS = 86400000;
export function tripDates(c: TripConditions): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${c.startDate}T00:00:00Z`); t <= Date.parse(`${c.endDate}T00:00:00Z`); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const strip = (s: string | null | undefined) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const round1 = (v: number) => Math.round(v * 10) / 10;
function meters(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }) {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return Infinity;
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return 6371000 * Math.hypot(x, y);
}
const intro = (raw: Record<string, string> | null, ...keys: string[]) => {
  for (const k of keys) if (raw?.[k]?.trim()) return raw[k];
  return null;
};
/** 소개 정보(detailIntro2)의 휴무일·이용시간 칸 이름 (장소 유형마다 다름) */
const REST_KEYS = ['restdate', 'restdateculture', 'restdateleports', 'restdatefood', 'restdateshopping'];
const HOURS_KEYS = ['usetime', 'usetimeculture', 'usetimeleports', 'opentimefood', 'opentime', 'playtime'];

/**
 * 후보 찾기 (회의 2단계, 코드만 씀 · LLM 0회)
 * ① 거르기: 지역·유형·폐업 제외·축제 날짜·휴무일·꼭 피할 것 ② 사람별 점수 ③ 사람마다 8곳 + 4명 합 상위로 40곳
 */
export async function retrieveCandidates(
  db: Db,
  opts: {
    conditions: TripConditions;
    destination: ResolvedDestination;
    members: readonly MemberInput[];
    crowdClient: TourClient | null;
    today?: string;
    /** 장소·음식 넣기 규칙을 코드가 이름으로 못 찾으면 같은 곳을 고르는 함수 (LLM 1회, names.ts). 없으면 맞추지 않음 */
    matchNames?: NameMatcher | null;
  },
): Promise<RetrieveResult> {
  const today = opts.today ?? todayKst();
  const { destination, members } = opts;
  const dates = tripDates(opts.conditions);
  const nights = dates.length - 1;
  const month = Number(dates[0].slice(5, 7));
  const tripMonth = dates[0].slice(0, 7).replace('-', '');
  const regionWords = [shortRegionName(destination.regionName)];

  const fields = {
    id: places.contentId,
    type: places.contentTypeId,
    title: places.title,
    lcls3: places.lcls3,
    overview: places.overview,
    introRaw: places.introRaw,
    lat: places.lat,
    lng: places.lng,
    districtCode: places.districtCode,
  };
  const types = nights > 0 ? [...RETRIEVE.types, RETRIEVE.lodgingType] : [...RETRIEVE.types];
  const rows = await db
    .select(fields)
    .from(places)
    .where(
      and(
        eq(places.visible, true),
        eq(places.regionCode, destination.regionCode),
        inArray(places.contentTypeId, types),
        destination.districtCodes.length ? inArray(places.districtCode, destination.districtCodes) : undefined,
      ),
    );

  // 사람의 규칙을 장소에 맞추는 함수 (종류는 분류 코드, 지역은 법정동 코드, 특정 음식·장소만 이름)
  const regionDistricts = await db
    .select({ districtCode: regions.districtCode, districtName: regions.districtName })
    .from(regions)
    .where(eq(regions.regionCode, destination.regionCode));
  const ctx = { regionWords, districtsOf: (word: string) => districtsNamed(word, regionDistricts) };
  const includes = new Map(members.map((m) => [m.memberId, m.mustKeep.filter((r) => r.type === 'include').map((r) => ({ rule: r, matches: ruleMatcher(r, ctx) }))]));
  const avoids = members.flatMap((m) => m.mustKeep.filter((r) => r.type === 'avoid').map((r) => ruleMatcher(r, ctx)));
  const viewOf = (p: (typeof rows)[number]): RulePlace => ({
    id: p.id,
    title: p.title,
    code: p.lcls3,
    districtCode: p.districtCode,
    isFood: p.type === RETRIEVE.foodType,
    menu: [intro(p.introRaw, 'firstmenu'), intro(p.introRaw, 'treatmenu')].filter(Boolean).join(' ') || null,
  });

  // ① 거르기 (빼는 이유와 예시를 남김)
  const excluded = new Map<string, string[]>();
  const drop = (reason: string, title: string) => excluded.set(reason, [...(excluded.get(reason) ?? []), title]);
  const startYmd = dates[0].replaceAll('-', '');
  const endYmd = dates[dates.length - 1].replaceAll('-', '');
  const rejectReason = (p: (typeof rows)[number]): string | null => {
    if (p.type === RETRIEVE.festivalType) {
      const s = intro(p.introRaw, 'eventstartdate');
      const e = intro(p.introRaw, 'eventenddate');
      if (!s || !e || s > endYmd || e < startYmd) return '축제가 여행 날짜에 열리지 않음';
    }
    if (dates.every((d) => closedOn(intro(p.introRaw, ...REST_KEYS), d) === 'closed')) return '여행 날짜가 휴무일';
    if (avoids.some((matches) => matches(viewOf(p)))) return '누군가 꼭 피할 것에 걸림';
    return null;
  };
  const kept = rows.filter((p) => {
    const reason = rejectReason(p);
    if (reason) drop(reason, p.title);
    return !reason;
  });

  // 꼭 지킬 것(넣기)이 구 단위 여행지에 하나도 없을 때: 같은 시·도의 다른 구·군에서 같은 거르기를 거친 곳을 찾음 (10/16 사용자 결정)
  // 지역 규칙(예: 사하구 여행 + '영도 방문')은 장소 하나로 채울 수 없어 넣지 않고 기록만 함 (4단계 안건)
  const districtName = new Map(regionDistricts.map((r) => [r.districtCode, r.districtName]));
  const keptViews = kept.map(viewOf);
  const unmet = destination.districtCodes.length
    ? members.flatMap((m) => (includes.get(m.memberId) ?? []).filter((k) => !keptViews.some(k.matches)).map((k) => ({ memberId: m.memberId, k })))
    : [];
  const unmetPlaces = unmet.filter((u) => u.k.rule.target !== 'area');
  const outsideRows = unmetPlaces.length
    ? (
        await db
          .select(fields)
          .from(places)
          .where(
            and(
              eq(places.visible, true),
              eq(places.regionCode, destination.regionCode),
              inArray(places.contentTypeId, types),
              notInArray(places.districtCode, destination.districtCodes),
            ),
          )
      ).filter((p) => !rejectReason(p))
    : [];
  const codeNames = new Map((await db.select({ code: categories.code, name: categories.name3 }).from(categories)).map((c) => [c.code, c.name]));
  const toMatchable = (p: (typeof rows)[number]) => ({ contentId: p.id, title: p.title, districtCode: p.districtCode });

  // 이름 맞추기 (LLM, 10/19 사용자 결정): 장소·음식 넣기 규칙이 이름·메뉴 글자로 시·도 안(여행지 + 같은 시·도의 다른 구·군) 어디에서도 맞지 않으면
  // 코드가 후보를 줄이고(글자 겹침·인기 순) LLM이 같은 곳을 고름. 맞춘 곳은 그 규칙의 꼭 지킬 곳이 됨 (예: 엘시티 전망대 = 부산엑스더스카이)
  const inRegion = [...kept, ...outsideRows];
  const nameRules = members.flatMap((m) =>
    (includes.get(m.memberId) ?? [])
      .filter((k) => (k.rule.target === 'place' || k.rule.target === 'food') && !!k.rule.keyword?.trim() && !inRegion.some((p) => k.matches(viewOf(p))))
      .map((k) => ({ memberId: m.memberId, k })),
  );
  const nameMatches: RetrieveResult['nameMatches'] = [];
  if (nameRules.length && opts.matchNames) {
    const regionPop = await popularity(db, { regionCode: destination.regionCode, tripMonth, places: inRegion.map(toMatchable), regionWords });
    const namePlaces: NamePlace[] = inRegion.map((p) => {
      const v = viewOf(p);
      const summary = p.overview ? p.overview.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
      return { id: p.id, title: p.title, category: (p.lcls3 && codeNames.get(p.lcls3)) ?? null, district: (p.districtCode && districtName.get(p.districtCode)) ?? null, isFood: v.isFood, menu: v.menu, summary, popularity: regionPop.scores.get(p.id) ?? null };
    });
    const asked: NameRule[] = nameRules.map((x, i) => ({ key: String(i), label: x.k.rule.label, keyword: x.k.rule.keyword!.trim(), target: x.k.rule.target as 'place' | 'food' }));
    const found = await opts.matchNames(asked, namePlaces);
    const titleOf = new Map(inRegion.map((p) => [p.id, p.title]));
    for (const [i, x] of nameRules.entries()) {
      const ids = new Set((found.get(String(i)) ?? []).filter((id) => titleOf.has(id)));
      if (!ids.size) continue;
      const byCode = x.k.matches;
      x.k.matches = (v) => byCode(v) || (!!v.id && ids.has(v.id));
      nameMatches.push({ memberId: x.memberId, label: x.k.rule.label, keyword: x.k.rule.keyword!.trim(), places: [...ids].map((id) => titleOf.get(id)!), ids: [...ids] });
    }
  }
  // 이름 맞추기로 여행지 안에서 찾은 규칙은 여행지 밖에서 찾지 않음
  const outsideMatches = unmetPlaces
    .filter((u) => !keptViews.some(u.k.matches))
    .map((u) => ({ memberId: u.memberId, rule: u.k.rule, rows: outsideRows.filter((p) => u.k.matches(viewOf(p))) }));
  const outsideFound = [...new Map(outsideMatches.flatMap((u) => u.rows).map((p) => [p.id, p])).values()];

  const isLodging = (p: { type: number }) => p.type === RETRIEVE.lodgingType;
  const matchable = kept.map(toMatchable);
  const districtCodes = destination.districtCodes.length ? destination.districtCodes : regionDistricts.map((r) => r.districtCode);
  const pop = await popularity(db, { regionCode: destination.regionCode, tripMonth, places: matchable, regionWords });
  const crw = await crowd(db, opts.crowdClient, { regionCode: destination.regionCode, districtCodes, dates, places: matchable, regionWords, today });
  // 여행지 밖 장소의 인기도는 여행지 장소와 함께 계산해 같은 잣대로 매김 (여행지 장소의 값은 위 계산 그대로, DB만 씀). 혼잡 예측은 여행지 구·군만 받으므로 없음
  const outsidePop = outsideFound.length
    ? (await popularity(db, { regionCode: destination.regionCode, tripMonth, places: [...matchable, ...outsideFound.map(toMatchable)], regionWords })).scores
    : new Map<string, number>();
  const outsideIds = new Set(outsideFound.map((p) => p.id));

  // ② 사람별 점수 (좋아요·싫어요·꼭 지킬 것 모두 코드로 맞춤, 장소 이름·소개글의 글자로 종류를 추측하지 않음)
  const viewById = new Map<string, RulePlace>();
  const toCandidate = (p: (typeof rows)[number]): Candidate => {
    const view = viewOf(p);
    viewById.set(p.id, view);
    const category = (p.lcls3 && codeNames.get(p.lcls3)) ?? null;
    const popularityScore = (outsideIds.has(p.id) ? outsidePop.get(p.id) : pop.scores.get(p.id)) ?? null;
    const crowdScore = crw.scores.get(p.id) ?? null;
    const rest = intro(p.introRaw, ...REST_KEYS);
    const scores: Record<string, number> = {};
    const reasons: Record<string, string[]> = {};
    const marks: Record<string, Mark[]> = {};
    for (const m of members) {
      let s = 0;
      const why: string[] = [];
      const mark: Mark[] = [];
      const liked = m.likes.filter((l) => likeMatches(l, view));
      if (liked.length) {
        s += RETRIEVE.likePoint * Math.min(liked.length, RETRIEVE.likeMax);
        why.push(`좋아요: ${liked.map(likeText).join('·')}`);
        mark.push({ kind: 'like', label: liked.map(likeText).join('·') });
      }
      for (const k of includes.get(m.memberId) ?? []) {
        if (k.matches(view)) {
          s += RETRIEVE.mustKeepPoint;
          why.push(`꼭 지킬 것: ${k.rule.label}`);
          mark.push({ kind: 'must', label: k.rule.label });
        }
      }
      if (popularityScore !== null && m.profile.weights.popularity) {
        const v = (popularityScore / 100) * m.profile.weights.popularity * RETRIEVE.popularityRange;
        s += v;
        if (v >= 0.8) why.push('이름난 곳');
      }
      if (crowdScore !== null) {
        if (m.profile.weights.crowd) {
          const v = ((crowdScore - 50) / 50) * m.profile.weights.crowd * RETRIEVE.crowdRange;
          s += v;
          if (v >= 0.6) why.push(m.profile.weights.crowd > 0 ? '활기찬 날' : '한산한 날');
        }
        if (m.profile.maxCrowd !== null && crowdScore > m.profile.maxCrowd) {
          s += RETRIEVE.dislikePoint;
          why.push(`붐빔 예측 ${crowdScore} (붐비는 곳 싫어요)`);
          mark.push({ kind: 'crowd', label: `${crowdScore}` });
        }
      }
      for (const d of m.dislikes.filter((d) => dislikeMatches(d, view))) {
        s += RETRIEVE.dislikePoint;
        why.push(`싫어요: ${dislikeText(d)}`);
        mark.push({ kind: 'dislike', label: dislikeText(d) });
      }
      scores[m.memberId] = round1(s);
      reasons[m.memberId] = why;
      marks[m.memberId] = mark;
    }
    return {
      id: p.id,
      name: p.title,
      type: p.type,
      category,
      popularity: popularityScore,
      crowd: crowdScore,
      hours: hoursLabel(intro(p.introRaw, ...HOURS_KEYS), month),
      open: hoursOn(intro(p.introRaw, ...HOURS_KEYS), month),
      restUnknown: dates.some((d) => closedOn(rest, d) === 'unknown'),
      summary: strip(p.overview).slice(0, RETRIEVE.summaryChars),
      menu: view.isFood ? view.menu : null,
      lat: p.lat,
      lng: p.lng,
      scores,
      total: round1(Object.values(scores).reduce((a, b) => a + b, 0)),
      reasons,
      marks,
      forMembers: [],
    };
  };
  const scored = kept.filter((p) => !isLodging(p)).map(toCandidate);
  const lodgingScored = kept.filter(isLodging).map(toCandidate);

  // ③ 뽑기: 사람마다 8곳 → 4명 합 상위로 채움 → 음식점 최소 수 → 같은 곳은 하나만
  const byTotal = [...scored].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const isMust = (c: Candidate) => Object.values(c.reasons).some((r) => r.some((w) => w.startsWith('꼭 지킬 것')));
  const mustIds = new Set(scored.filter(isMust).map((c) => c.id));
  const chosen = new Map<string, Candidate>();
  const sameSpot = (a: Candidate, b: Candidate) => {
    if (a.type === RETRIEVE.foodType || b.type === RETRIEVE.foodType) return false;
    const x = normName(a.name, regionWords);
    const y = normName(b.name, regionWords);
    return (x.startsWith(y) || y.startsWith(x)) && meters(a, b) <= RETRIEVE.sameSpotMeters;
  };
  const dup = (c: Candidate) => [...chosen.values()].find((k) => sameSpot(k, c));
  const add = (c: Candidate, memberId?: string) => {
    const twin = chosen.has(c.id) ? null : dup(c);
    if (twin && !mustIds.has(c.id)) {
      if (memberId && !twin.forMembers.includes(memberId)) twin.forMembers.push(memberId);
      return false;
    }
    const k = chosen.get(c.id) ?? c;
    if (memberId && !k.forMembers.includes(memberId)) k.forMembers.push(memberId);
    chosen.set(c.id, k);
    return true;
  };
  const sameSpotDropped: string[] = [];
  for (const m of members) {
    const mine = [...scored].sort((a, b) => b.scores[m.memberId] - a.scores[m.memberId] || b.total - a.total || a.id.localeCompare(b.id));
    // 몫을 채우는 순서: 꼭 지킬 것마다 최대 2곳 → 좋아요 보기를 돌아가며 1곳씩 → 나머지는 점수 순 (좋아요 하나로 몫이 다 차지 않게)
    const order: Candidate[] = [];
    const seen = new Set<string>();
    const push = (c: Candidate) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      order.push(c);
    };
    for (const k of includes.get(m.memberId) ?? []) mine.filter((c) => k.matches(viewById.get(c.id)!)).slice(0, RETRIEVE.mustKeepPerRule).forEach(push);
    const queues = m.likes.map((l) => mine.filter((c) => likeMatches(l, viewById.get(c.id)!)));
    const next = queues.map(() => 0);
    for (let moved = true; moved; ) {
      moved = false;
      for (const [i, q] of queues.entries()) {
        while (next[i] < q.length && seen.has(q[next[i]].id)) next[i]++;
        if (next[i] < q.length) {
          push(q[next[i]++]);
          moved = true;
        }
      }
    }
    mine.forEach(push);
    let taken = 0;
    for (const c of order) {
      if (taken >= RETRIEVE.perMember) break;
      const already = chosen.get(c.id);
      if (already) {
        if (!already.forMembers.includes(m.memberId)) already.forMembers.push(m.memberId);
        taken++;
      } else if (add(c, m.memberId)) taken++;
      else sameSpotDropped.push(c.name);
    }
  }
  const foodCount = () => [...chosen.values()].filter((c) => c.type === RETRIEVE.foodType).length;
  for (const c of byTotal) {
    if (chosen.size >= RETRIEVE.poolSize) break;
    if (chosen.has(c.id) || (c.type === RETRIEVE.foodType && foodCount() >= RETRIEVE.maxFood)) continue;
    if (!add(c)) sameSpotDropped.push(c.name);
  }
  const foods = byTotal.filter((c) => c.type === RETRIEVE.foodType && !chosen.has(c.id));
  while (foodCount() < RETRIEVE.minFood && foods.length) {
    // 뺄 곳: 꼭 지킬 것이 아닌 음식점 밖의 곳 중 맡은 사람이 적고 점수가 낮은 곳 (40곳이 모두 누군가의 몫이어도 끼니 후보는 채움)
    const removable = [...chosen.values()]
      .filter((c) => c.type !== RETRIEVE.foodType && !mustIds.has(c.id))
      .sort((a, b) => a.forMembers.length - b.forMembers.length || a.total - b.total)[0];
    if (!removable && chosen.size >= RETRIEVE.poolSize) break;
    if (removable) chosen.delete(removable.id);
    chosen.set(foods[0].id, foods.shift()!);
  }
  for (const n of new Set(sameSpotDropped)) drop('같은 곳이라 하나만 남김', n);

  // 여행지 밖: 꼭 지킬 것마다 그 사람 점수 1위(같으면 4명 합 → 인기도) outsidePerRule곳을 40곳·숙소 10곳과 따로 넣고 시·군·구 이름을 붙임
  const outsideCands = new Map(outsideFound.map((p) => [p.id, { ...toCandidate(p), outside: (p.districtCode && districtName.get(p.districtCode)) || p.districtCode || '' }]));
  const outsideSpots = new Map<string, Candidate>();
  const outsideLodgings = new Map<string, Candidate>();
  const outsideRules: RetrieveResult['outsideRules'] = [];
  const home = centerOf(kept);
  const minutesOf = (p: { lat: number | null; lng: number | null }) => (home && p.lat !== null && p.lng !== null ? oneWayMinutes(home, { lat: p.lat, lng: p.lng }) : null);
  for (const u of outsideMatches) {
    const near = u.rows.filter((p) => (minutesOf(p) ?? Infinity) <= RETRIEVE.outsideMaxMinutes);
    if (u.rows.length && !near.length) {
      // 맞는 곳이 모두 편도 상한보다 멀면 넣지 않고 가장 가까운 곳의 시간만 안건 메모로 남김
      const closest = u.rows.map((p) => ({ p, m: minutesOf(p) })).filter((x) => x.m !== null).sort((a, b) => a.m! - b.m!)[0];
      if (closest) outsideRules.push({ memberId: u.memberId, label: u.rule.label, district: outsideCands.get(closest.p.id)!.outside!, placeId: null, minutes: closest.m! });
      continue;
    }
    const best = near
      .map((p) => outsideCands.get(p.id)!)
      .sort((a, b) => b.scores[u.memberId] - a.scores[u.memberId] || b.total - a.total || (b.popularity ?? -1) - (a.popularity ?? -1) || a.id.localeCompare(b.id))
      .slice(0, RETRIEVE.outsidePerRule);
    for (const c of best) {
      if (!c.forMembers.includes(u.memberId)) c.forMembers.push(u.memberId);
      (isLodging(c) ? outsideLodgings : outsideSpots).set(c.id, c);
      c.outsideMinutes = minutesOf(c) ?? undefined;
      outsideRules.push({ memberId: u.memberId, label: u.rule.label, district: c.outside!, placeId: c.id, minutes: c.outsideMinutes });
    }
  }
  for (const u of unmet.filter((x) => x.k.rule.target === 'area')) {
    const codes = ctx.districtsOf(u.k.rule.keyword?.trim() ?? '');
    if (codes.length && !codes.some((d) => destination.districtCodes.includes(d))) {
      outsideRules.push({ memberId: u.memberId, label: u.k.rule.label, district: codes.map((d) => districtName.get(d) ?? d).join('·'), placeId: null });
    }
  }

  const candidates = [...chosen.values(), ...outsideSpots.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  // 숙소 후보 (1박 이상): 누군가의 꼭 지킬 것에 맞는 곳 먼저 → 4명 합계 → 인기도 순
  const lodgings = [...lodgingScored]
    .sort((a, b) => Number(isMust(b)) - Number(isMust(a)) || b.total - a.total || (b.popularity ?? -1) - (a.popularity ?? -1) || a.id.localeCompare(b.id))
    .slice(0, RETRIEVE.lodgingPoolSize)
    .concat([...outsideLodgings.values()]);
  const tableOf = (list: readonly Candidate[]) =>
    ['id|이름|분류|인기|혼잡|영업|요약']
      .concat(list.map((c) => [c.id, c.name, (c.category ?? '-').replace(/\s*\/\s*/g, '/'), c.popularity ?? '-', c.crowd ?? '-', c.hours ?? '-', c.summary.replaceAll('|', '/')].join('|')))
      .join('\n');
  const table = tableOf(candidates);

  // 꼭 지킬 것(넣기)이 후보에 하나도 없으면 표시 없이 빠지지 않게 까닭과 함께 남김 (4단계 안건 메모). 여행지 밖 메모가 있는 규칙은 거기서 이미 알림
  const pool = [...candidates, ...lodgings];
  const missingRules: RetrieveResult['missingRules'] = [];
  for (const m of members) {
    for (const k of includes.get(m.memberId) ?? []) {
      if (pool.some((c) => c.marks[m.memberId]?.some((x) => x.kind === 'must' && x.label === k.rule.label))) continue;
      if (outsideRules.some((r) => r.memberId === m.memberId && r.label === k.rule.label)) continue;
      const blocked = rows.some((p) => rejectReason(p) && k.matches(viewOf(p)));
      missingRules.push({ memberId: m.memberId, label: k.rule.label, reason: blocked ? '여행 날짜가 휴무이거나 다른 사람의 꼭 피할 것에 걸림' : '여행지 자료에서 찾지 못함' });
    }
  }
  const sources = ['tour_api'];
  if (pop.matched) sources.push('tour_rank');
  if (crw.scores.size) sources.push('tour_crowd');
  return {
    destination,
    dates,
    candidates,
    table,
    nights,
    lodgings,
    lodgingTable: nights > 0 ? tableOf(lodgings) : '',
    stages: [
      { label: '지역·후보 유형', count: rows.filter((p) => !isLodging(p)).length },
      { label: '축제 날짜·휴무일·꼭 피할 것을 거른 뒤', count: scored.length },
      { label: '고른 후보', count: candidates.length },
      { label: `숙소 후보 (${nights}박${nights ? `, 숙박 ${rows.filter(isLodging).length}곳 중` : ' · 당일치기라 뽑지 않음'})`, count: lodgings.length },
      ...(outsideSpots.size + outsideLodgings.size ? [{ label: '꼭 지킬 것이 여행지에 없어 같은 시·도에서 넣은 곳', count: outsideSpots.size + outsideLodgings.size }] : []),
      ...(nameMatches.length ? [{ label: '이름 맞추기(LLM)로 찾은 꼭 지킬 것', count: nameMatches.length }] : []),
    ],
    excluded: [...excluded].map(([reason, list]) => ({ reason, count: list.length, examples: list.slice(0, 3) })),
    popularity: { baseYm: pop.baseYm, matched: pop.matched },
    crowd: { fetched: crw.fetched, cached: crw.cached, matched: crw.scores.size, note: crw.note },
    sources,
    baseDate: today,
    outsideRules,
    nameMatches,
    missingRules,
  };
}
