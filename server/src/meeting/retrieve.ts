import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, places, regions } from '../db/schema.js';
import { todayKst } from '../lib/time.js';
import type { MustKeepRule, PersonaProfile } from '../persona/types.js';
import type { TourClient } from '../tour/client.js';
import { CANDIDATE_TYPES, LODGING_TYPE } from './categories.js';
import { crowd } from './crowd.js';
import { closedOn, hoursLabel } from './hours.js';
import { normName } from './match.js';
import { popularity } from './popularity.js';
import { districtsNamed, shortRegionName } from './regions.js';
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
  summaryChars: 60,
} as const;

export interface MemberInput {
  memberId: string;
  nickname: string;
  title: string;
  likes: readonly string[];
  dislikes: readonly string[];
  mustKeep: readonly MustKeepRule[];
  profile: PersonaProfile;
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
  /** 휴무일 문장을 읽지 못한 장소 (빼지 않고 '확인 필요'로 표시) */
  restUnknown: boolean;
  summary: string;
  lat: number | null;
  lng: number | null;
  scores: Record<string, number>;
  total: number;
  reasons: Record<string, string[]>;
  /** 이 사람 몫으로 들어간 후보 (점수 상위 8곳) */
  forMembers: string[];
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
  opts: { conditions: TripConditions; destination: ResolvedDestination; members: readonly MemberInput[]; crowdClient: TourClient | null; today?: string },
): Promise<RetrieveResult> {
  const today = opts.today ?? todayKst();
  const { destination, members } = opts;
  const dates = tripDates(opts.conditions);
  const nights = dates.length - 1;
  const month = Number(dates[0].slice(5, 7));
  const tripMonth = dates[0].slice(0, 7).replace('-', '');
  const regionWords = [shortRegionName(destination.regionName)];

  const rows = await db
    .select({
      id: places.contentId,
      type: places.contentTypeId,
      title: places.title,
      lcls3: places.lcls3,
      overview: places.overview,
      introRaw: places.introRaw,
      lat: places.lat,
      lng: places.lng,
      districtCode: places.districtCode,
    })
    .from(places)
    .where(
      and(
        eq(places.visible, true),
        eq(places.regionCode, destination.regionCode),
        inArray(places.contentTypeId, nights > 0 ? [...RETRIEVE.types, RETRIEVE.lodgingType] : [...RETRIEVE.types]),
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
  const kept = rows.filter((p) => {
    if (p.type === RETRIEVE.festivalType) {
      const s = intro(p.introRaw, 'eventstartdate');
      const e = intro(p.introRaw, 'eventenddate');
      if (!s || !e || s > endYmd || e < startYmd) {
        drop('축제가 여행 날짜에 열리지 않음', p.title);
        return false;
      }
    }
    const rest = intro(p.introRaw, ...REST_KEYS);
    if (dates.every((d) => closedOn(rest, d) === 'closed')) {
      drop('여행 날짜가 휴무일', p.title);
      return false;
    }
    const view = viewOf(p);
    if (avoids.some((matches) => matches(view))) {
      drop('누군가 꼭 피할 것에 걸림', p.title);
      return false;
    }
    return true;
  });

  const isLodging = (p: { type: number }) => p.type === RETRIEVE.lodgingType;
  const matchable = kept.map((p) => ({ contentId: p.id, title: p.title, districtCode: p.districtCode }));
  const districtCodes = destination.districtCodes.length ? destination.districtCodes : regionDistricts.map((r) => r.districtCode);
  const pop = await popularity(db, { regionCode: destination.regionCode, tripMonth, places: matchable, regionWords });
  const crw = await crowd(db, opts.crowdClient, { regionCode: destination.regionCode, districtCodes, dates, places: matchable, regionWords, today });

  // ② 사람별 점수 (좋아요·싫어요·꼭 지킬 것 모두 코드로 맞춤, 장소 이름·소개글의 글자로 종류를 추측하지 않음)
  const codeNames = new Map((await db.select({ code: categories.code, name: categories.name3 }).from(categories)).map((c) => [c.code, c.name]));
  const viewById = new Map<string, RulePlace>();
  const toCandidate = (p: (typeof rows)[number]): Candidate => {
    const view = viewOf(p);
    viewById.set(p.id, view);
    const category = (p.lcls3 && codeNames.get(p.lcls3)) ?? null;
    const popularityScore = pop.scores.get(p.id) ?? null;
    const crowdScore = crw.scores.get(p.id) ?? null;
    const rest = intro(p.introRaw, ...REST_KEYS);
    const scores: Record<string, number> = {};
    const reasons: Record<string, string[]> = {};
    for (const m of members) {
      let s = 0;
      const why: string[] = [];
      const liked = m.likes.filter((l) => likeMatches(l, view));
      if (liked.length) {
        s += RETRIEVE.likePoint * Math.min(liked.length, RETRIEVE.likeMax);
        why.push(`좋아요: ${liked.map(likeText).join('·')}`);
      }
      for (const k of includes.get(m.memberId) ?? []) {
        if (k.matches(view)) {
          s += RETRIEVE.mustKeepPoint;
          why.push(`꼭 지킬 것: ${k.rule.label}`);
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
        }
      }
      for (const d of m.dislikes.filter((d) => dislikeMatches(d, view))) {
        s += RETRIEVE.dislikePoint;
        why.push(`싫어요: ${dislikeText(d)}`);
      }
      scores[m.memberId] = round1(s);
      reasons[m.memberId] = why;
    }
    return {
      id: p.id,
      name: p.title,
      type: p.type,
      category,
      popularity: popularityScore,
      crowd: crowdScore,
      hours: hoursLabel(intro(p.introRaw, ...HOURS_KEYS), month),
      restUnknown: dates.some((d) => closedOn(rest, d) === 'unknown'),
      summary: strip(p.overview).slice(0, RETRIEVE.summaryChars),
      lat: p.lat,
      lng: p.lng,
      scores,
      total: round1(Object.values(scores).reduce((a, b) => a + b, 0)),
      reasons,
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

  const candidates = [...chosen.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  // 숙소 후보 (1박 이상): 누군가의 꼭 지킬 것에 맞는 곳 먼저 → 4명 합계 → 인기도 순
  const lodgings = [...lodgingScored]
    .sort((a, b) => Number(isMust(b)) - Number(isMust(a)) || b.total - a.total || (b.popularity ?? -1) - (a.popularity ?? -1) || a.id.localeCompare(b.id))
    .slice(0, RETRIEVE.lodgingPoolSize);
  const tableOf = (list: readonly Candidate[]) =>
    ['id|이름|분류|인기|혼잡|영업|요약']
      .concat(list.map((c) => [c.id, c.name, (c.category ?? '-').replace(/\s*\/\s*/g, '/'), c.popularity ?? '-', c.crowd ?? '-', c.hours ?? '-', c.summary.replaceAll('|', '/')].join('|')))
      .join('\n');
  const table = tableOf(candidates);
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
    ],
    excluded: [...excluded].map(([reason, list]) => ({ reason, count: list.length, examples: list.slice(0, 3) })),
    popularity: { baseYm: pop.baseYm, matched: pop.matched },
    crowd: { fetched: crw.fetched, cached: crw.cached, matched: crw.scores.size, note: crw.note },
    sources,
    baseDate: today,
  };
}
