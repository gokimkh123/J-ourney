import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categories, places, regions } from '../db/schema.js';
import { DAY_MS, todayKst } from '../lib/time.js';
import type { MustKeepRule, PersonaProfile } from '../persona/types.js';
import type { TourClient } from '../tour/client.js';
import { CANDIDATE_TYPES, LODGING_TYPE } from './categories.js';
import { crowd } from './crowd.js';
import { type OpenHours, closedOn, hoursLabel, hoursOn } from './hours.js';
import { normName } from './match.js';
import type { AreaMatcher, AreaRule } from './areas.js';
import type { NameMatcher, NamePlace, NameRule } from './names.js';
import { popularity } from './popularity.js';
import { shortRegionName, withSubDistricts } from './regions.js';
import { centerOf, oneWayMinutes } from './travel.js';
import { type RulePlace, dislikeMatches, dislikeText, isAreaRule, isDietAvoid, isLegacyRule, isNameRule, likeMatches, likeText, ruleMatcher } from './rules.js';
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
  /**
   * 종류(category) 꼭 지킬 것은 자기 몫과 따로 그 사람 점수 순 다음 후보를 이만큼 더 넣어 3단계 AI가 소개글로 뜻에 맞는 곳을 고르게 함
   * (10/23 사용자 결정: 덜 알려진 곳 선호는 그대로 두고, 공식 분류가 넓어 '시장 구경'에 조명 도매 상가만 오르는 일을 줄임)
   */
  mustKeepKindExtra: 2,
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
  /** 집중률 점수의 가운데(이보다 붐비면 +, 한산하면 −) · 이유 글에 '이름난 곳'·'활기찬/한산한 날'을 적는 점수 하한 */
  crowdNeutral: 50,
  popularReasonMin: 0.8,
  crowdReasonMin: 0.6,
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
  /**
   * 여행지로 가는 곳이 아닌 시설의 공식 분류 (10/27 사용자 결정, 검증27에서 일정에 들어간 엉뚱한 곳): 후보에 넣지 않음. 단 누군가 꼭 지킬 것(넣기)으로 고른 곳은 넣음
   * 사후면세점(체인 매장)·대형마트 · 공연장·영화관(공연·상영이 없으면 볼 것이 없음) · 컨벤션센터 · 문화원·도서관·학교 · 경기장·수련시설 · 교통시설 · 골프장(예약제)
   * 10/19에 좋아요 분류에서 뺀 곳과 같은 선. '기타' 분류(기타쇼핑시설·기타체험관광·기타행사)는 좋은 곳이 섞여 있어 넣지 않음
   */
  notDestinationCodes: ['SH0403', 'SH0301', 'VE0601', 'VE0602', 'VE070400', 'VE0901', 'VE0902', 'VE0903', 'VE0906', 'VE1001', 'VE1002', 'VE11', 'LS010400'],
  /**
   * 숙소·가게의 공식 분류 (10/27 사용자 결정): 장소 이름으로 찾는 꼭 지킬 것에서, 이름이 같은 곳 중 숙소·가게가 아닌 곳이 있으면 숙소·가게는 꼭 지킬 곳으로 보지 않음
   * (예: 경복궁 → 앤더슨벨 경복궁 스토어, 경포대 → 경포대 산호 펜션). 숙소·가게만 맞으면(예: 이재모피자) 그대로 씀
   * 숙박 · 음식점·카페 · 면세점·전문매장·기타쇼핑시설 (시장·백화점·쇼핑몰은 가는 곳으로 봄)
   */
  businessCodes: ['AC', 'FD', 'SH04', 'SH05', 'SH07'],
} as const;

/** 이름·지역 규칙인데 맞추기 LLM의 답을 받지 못했을 때 메모 */
export const NO_NAME_ANSWER = 'AI 맞추기를 하지 못해 적용하지 못함 (하루 AI 상한·오류·AI 0번 모드)';

/** 숙소·가게인지 (공식 분류 코드로만 봄) */
export const isBusiness = (code: string | null) => !!code && RETRIEVE.businessCodes.some((c) => code.startsWith(c));

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
  /** 공식 분류 코드 (lcls3). 6단계가 야경 전망대·카페를 가릴 때 씀 (이 칸이 생기기 전 회의의 후보에는 없음) */
  code?: string | null;
  /** 휴무일 문장 원문. 6단계가 날마다 쉬는 날인지 볼 때 씀 */
  rest?: string | null;
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
  /** 숙박 일수 (당일치기 0) */
  nights: number;
  /** 숙소 후보 (1박 이상일 때만, 40곳과 따로). 3단계 LLM 입력 표는 사람마다 pickTables(pick.ts)가 만듦 */
  lodgings: Candidate[];
  stages: { label: string; count: number }[];
  excluded: { reason: string; count: number; examples: string[] }[];
  popularity: { baseYm: string | null; matched: number };
  crowd: { fetched: string[]; cached: string[]; matched: number; note: string | null };
  sources: string[];
  baseDate: string;
  /** 꼭 지킬 것(넣기)이 여행지에 없고 같은 시·도의 다른 구·군에만 있는 것 (placeId: 넣은 후보 id, 지역 규칙이라 넣지 못했으면 null) */
  /** minutes: 여행지 가운데에서 편도 어림 (분). 넣은 곳은 그 곳까지, 멀어서 못 넣은 규칙은 가장 가까운 곳까지 */
  outsideRules: { memberId: string; label: string; district: string; placeId: string | null; minutes?: number }[];
  /**
   * 이름·지역 맞추기(LLM)로 맞춘 규칙: 넣기(꼭 지킬 것)·피하기(꼭 피할 것), 사람이 쓴 말(keyword)과 맞춘 장소 id·구·군 코드(districts, 지역 규칙)와 그 이름
   * 4단계 메모로 보이고, 6단계 끼니 보충 식당도 이 값으로만 맞춤
   */
  nameMatches: { memberId: string; type: 'include' | 'avoid'; label: string; keyword: string; places: string[]; ids: string[]; districts?: string[] }[];
  /** 꼭 지킬 것(넣기)인데 후보에 하나도 없는 것과 그 까닭 (여행지 밖 메모가 있는 것은 빼고) */
  missingRules: { memberId: string; label: string; reason: string }[];
}

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
export const intro = (raw: Record<string, string> | null, ...keys: string[]) => {
  for (const k of keys) if (raw?.[k]?.trim()) return raw[k];
  return null;
};
/** 소개 정보(detailIntro2)의 휴무일·이용시간 칸 이름 (장소 유형마다 다름) */
export const REST_KEYS = ['restdate', 'restdateculture', 'restdateleports', 'restdatefood', 'restdateshopping'];
export const HOURS_KEYS = ['usetime', 'usetimeculture', 'usetimeleports', 'opentimefood', 'opentime', 'playtime'];

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
    /** 꼭 지킬 것·꼭 피할 것의 장소·음식 이름을 장소 목록에서 맞추는 함수 (LLM, names.ts). 없으면 맞추지 않고 메모만 남김 */
    matchNames?: NameMatcher | null;
    /** 지역 조건을 구·군 목록 또는 장소 목록에서 맞추는 함수 (LLM, areas.ts). 없으면 맞추지 않고 메모만 남김 */
    matchAreas?: AreaMatcher | null;
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

  type Row = (typeof rows)[number];

  // 사람의 규칙을 장소에 맞추는 함수 (종류는 분류 코드, 장소·음식 이름과 지역은 2단계 LLM이 고른 장소 번호·구·군 코드 — 10/29 사용자 결정: 코드가 글자로 맞추지 않음)
  const regionDistricts = await db
    .select({ districtCode: regions.districtCode, districtName: regions.districtName })
    .from(regions)
    .where(eq(regions.regionCode, destination.regionCode));
  const tripDistricts = destination.districtCodes.length ? destination.districtCodes : regionDistricts.map((r) => r.districtCode);
  // LLM이 고른 장소 id(이름 규칙·장소를 고른 지역 규칙)와 구·군 코드(지역 규칙) — 아래 askNames·지역 맞추기가 채움
  const named = new Map<MustKeepRule, Set<string>>();
  const areaPicked = new Map<MustKeepRule, Set<string>>();
  const matcherOf = (r: MustKeepRule) =>
    isNameRule(r) || isAreaRule(r)
      ? (v: RulePlace) => (!!v.id && !!named.get(r)?.has(v.id)) || (!!v.districtCode && !!areaPicked.get(r)?.has(v.districtCode))
      : ruleMatcher(r);
  const includes = new Map(members.map((m) => [m.memberId, m.mustKeep.filter((r) => r.type === 'include' && !isLegacyRule(r)).map((r) => ({ rule: r, matches: matcherOf(r) }))]));
  const avoidRules = members.flatMap((m) => m.mustKeep.filter((r) => r.type === 'avoid' && !isLegacyRule(r) && !isDietAvoid(r)).map((r) => ({ memberId: m.memberId, rule: r, matches: matcherOf(r) })));
  const avoids = avoidRules.map((a) => a.matches);
  const viewOf = (p: Row): RulePlace => ({
    id: p.id,
    title: p.title,
    code: p.lcls3,
    districtCode: p.districtCode,
    isFood: p.type === RETRIEVE.foodType,
    menu: [intro(p.introRaw, 'firstmenu'), intro(p.introRaw, 'treatmenu')].filter(Boolean).join(' ') || null,
  });

  // 장소 이름 규칙은 숙소·가게가 아닌 곳으로 맞을 때만 그 지역에서 지킨 것으로 봄 (이름에 같은 낱말이 든 펜션·가게만 있으면 여행지 밖·이름 맞추기에서 더 찾음)
  const metIn = (views: readonly RulePlace[], k: { rule: MustKeepRule; matches: (v: RulePlace) => boolean }) =>
    views.some((v) => k.matches(v) && (k.rule.target !== 'place' || !isBusiness(v.code)));
  const notDestination = (code: string | null) => !!code && RETRIEVE.notDestinationCodes.some((c) => code.startsWith(c));
  // 제외 분류라도 누군가 꼭 지킬 것으로 고른 곳은 넣음 (장소 이름 규칙은 숙소·가게가 아닌 곳일 때만: 이름에 같은 낱말이 든 매장은 넣지 않음)
  // 구·군을 고른 지역 규칙은 장소 종류를 정하지 않으므로 제외 시설을 끌어들이지 않음 (10/28 점검: '해운대' 지역 규칙으로 사후면세점·대형마트·도서관이 꼭 지킬 곳이 됨). 장소를 고른 지역 규칙은 그 장소만
  const wanted = (p: Row) => {
    const v = [viewOf(p)];
    return [...includes.values()].some((list) => list.some((k) => !areaPicked.get(k.rule)?.size && metIn(v, k)));
  };

  // 이름 맞추기 (LLM, 10/29 사용자 결정 '가'): 꼭 지킬 것·꼭 피할 것의 장소·음식 이름은 LLM이 장소 목록에서 같은 곳의 번호를 고름 (코드는 목록만 줄임, names.ts)
  // 목록은 여행지의 모든 장소 (거르기 전, 숙소·가게는 빼고 음식점은 남김 — 10/27 검증: 엘시티 전망대 → 엘시티 레지던스(숙소)). 10/28 비교 시험과 같은 목록
  // 구 단위 여행에서 여행지 안에 맞는 곳이 없는 넣기 규칙은 아래에서 같은 시·도의 다른 구·군 목록으로 한 번 더 물음 (여행지 밖, 10/16 사용자 결정)
  const codeNames = new Map((await db.select({ code: categories.code, name: categories.name3 }).from(categories)).map((c) => [c.code, c.name]));
  const districtName = new Map(regionDistricts.map((r) => [r.districtCode, r.districtName]));
  const toMatchable = (p: Row) => ({ contentId: p.id, title: p.title, districtCode: p.districtCode });
  const titleOf = new Map<string, string>();
  /** LLM에게 보여 줄 장소 목록 (거르기 전, 숙소·가게는 빼고 음식점은 남김) */
  const listOf = async (from: readonly Row[]): Promise<NamePlace[]> => {
    const listed = from.filter((p) => p.type !== RETRIEVE.lodgingType);
    const listPop = await popularity(db, { regionCode: destination.regionCode, tripMonth, places: listed.map(toMatchable), regionWords });
    const out = listed
      .filter((p) => !isBusiness(p.lcls3) || p.type === RETRIEVE.foodType)
      .map((p) => {
        const v = viewOf(p);
        return { id: p.id, title: p.title, category: (p.lcls3 && codeNames.get(p.lcls3)) ?? null, district: (p.districtCode && districtName.get(p.districtCode)) ?? null, isFood: v.isFood, menu: v.menu, summary: strip(p.overview) || null, popularity: listPop.scores.get(p.id) ?? null };
      });
    for (const p of out) titleOf.set(p.id, p.title);
    return out;
  };
  let destinationList: NamePlace[] | null = null;
  const destinationPlaces = async () => (destinationList ??= await listOf(rows));
  const nameRules = [
    ...members.flatMap((m) => (includes.get(m.memberId) ?? []).filter((k) => isNameRule(k.rule)).map((k) => ({ memberId: m.memberId, rule: k.rule }))),
    ...avoidRules.filter((a) => isNameRule(a.rule)).map((a) => ({ memberId: a.memberId, rule: a.rule })),
  ];
  const areaRules = [
    ...members.flatMap((m) => (includes.get(m.memberId) ?? []).filter((k) => isAreaRule(k.rule)).map((k) => ({ memberId: m.memberId, rule: k.rule }))),
    ...avoidRules.filter((a) => isAreaRule(a.rule)).map((a) => ({ memberId: a.memberId, rule: a.rule })),
  ];
  /** LLM이 답한 이름·지역 규칙 (답이 없던 규칙은 'AI로 맞추지 못함' 메모) */
  const answered = new Set<MustKeepRule>();
  const askNames = async (list: readonly { memberId: string; rule: MustKeepRule }[], namePlaces: readonly NamePlace[]) => {
    if (!list.length || !opts.matchNames) return;
    // 보여 줄 장소가 없으면 묻지 않고 '맞는 곳 없음'으로 둠 (AI를 못 쓴 것과 구분)
    if (!namePlaces.length) {
      for (const x of list) answered.add(x.rule);
      return;
    }
    const asked: NameRule[] = list.map((x, i) => ({ key: String(i), type: x.rule.type === 'avoid' ? 'avoid' : 'include', label: x.rule.label, keyword: x.rule.keyword!.trim(), target: x.rule.target === 'food' ? 'food' : 'place' }));
    const found = await opts.matchNames(asked, namePlaces);
    for (const [i, x] of list.entries()) {
      const ids = found.get(String(i));
      if (!ids) continue;
      answered.add(x.rule);
      named.set(x.rule, new Set([...(named.get(x.rule) ?? []), ...ids.filter((id) => titleOf.has(id))]));
    }
  };
  if (nameRules.length && opts.matchNames) await askNames(nameRules, await destinationPlaces());

  // 지역 맞추기 (LLM, 10/29 사용자 결정): 15번에서 나온 지역 말(예: 서면 쪽 위주로)은 LLM이 여행지 시·도의 구·군 목록 또는 장소 목록에서 번호를 고름 (areas.ts)
  // 동네 이름은 그 동네가 있는 구·군 (장소 자료의 지역 표시가 구·군까지라 그보다 좁힐 수 없음), 특정 장소 이름은 그 장소 (예: 한옥마을 → 전북 전주 한옥마을)
  if (areaRules.length && opts.matchAreas) {
    const asked: AreaRule[] = areaRules.map((x, i) => ({ key: String(i), type: x.rule.type === 'avoid' ? 'avoid' : 'include', label: x.rule.label, keyword: x.rule.keyword!.trim(), said: x.rule.quote?.trim() || x.rule.label }));
    const found = await opts.matchAreas(asked, regionDistricts.map((d) => ({ code: d.districtCode, name: d.districtName })), await destinationPlaces());
    for (const [i, x] of areaRules.entries()) {
      const a = found.get(String(i));
      if (!a) continue;
      answered.add(x.rule);
      areaPicked.set(x.rule, new Set(withSubDistricts(a.districts, regionDistricts)));
      named.set(x.rule, new Set(a.ids.filter((id) => titleOf.has(id))));
    }
  }
  // 지역 넣기 규칙이 여행지의 모든 구·군을 가리키면 조건으로 쓰지 않고 메모만 남김: 모든 후보가 꼭 지킬 곳이 되어 거르기·고르기·자기 조건 검사가 무너짐
  // (10/28 점검, 예: 전주 여행 + '전주 가면 한옥마을이지' → 지역 전주. 여행지 구·군은 법정동 코드로만 비교함)
  const wholeTrip = (r: MustKeepRule) => isAreaRule(r) && tripDistricts.length > 0 && tripDistricts.every((d) => !!areaPicked.get(r)?.has(d));
  for (const [memberId, list] of includes) includes.set(memberId, list.filter((k) => !wholeTrip(k.rule)));
  const skippedRules = members.flatMap((m) => [
    ...m.mustKeep.filter((r) => r.type === 'include' && wholeTrip(r)).map((r) => ({ memberId: m.memberId, label: r.label, reason: '여행지 전체라 조건으로 쓰지 않음' })),
    ...m.mustKeep.filter(isLegacyRule).map((r) => ({ memberId: m.memberId, label: r.label, reason: '예전 성향 카드의 규칙이라 쓰지 않음 (성향을 다시 내면 쓰임)' })),
  ]);

  // ① 거르기 (빼는 이유와 예시를 남김)
  const excluded = new Map<string, string[]>();
  const drop = (reason: string, title: string) => excluded.set(reason, [...(excluded.get(reason) ?? []), title]);
  const startYmd = dates[0].replaceAll('-', '');
  const endYmd = dates[dates.length - 1].replaceAll('-', '');
  const rejectReason = (p: Row): string | null => {
    if (p.type === RETRIEVE.festivalType) {
      const s = intro(p.introRaw, 'eventstartdate');
      const e = intro(p.introRaw, 'eventenddate');
      if (!s || !e || s > endYmd || e < startYmd) return '축제가 여행 날짜에 열리지 않음';
    }
    if (dates.every((d) => closedOn(intro(p.introRaw, ...REST_KEYS), d) === 'closed')) return '여행 날짜가 휴무일';
    if (avoids.some((matches) => matches(viewOf(p)))) return '누군가 꼭 피할 것에 걸림';
    if (notDestination(p.lcls3) && !wanted(p)) return '여행지로 가는 곳이 아닌 시설';
    return null;
  };
  const kept = rows.filter((p) => {
    const reason = rejectReason(p);
    if (reason) drop(reason, p.title);
    return !reason;
  });

  // 꼭 지킬 것(넣기)이 구 단위 여행지에 하나도 없을 때: 같은 시·도의 다른 구·군에서 같은 거르기를 거친 곳을 찾음 (10/16 사용자 결정)
  // 지역 규칙(예: 사하구 여행 + '영도 방문')은 장소 하나로 채울 수 없어 넣지 않고 기록만 함 (4단계 안건). 이름 규칙은 다른 구·군 목록으로 이름 맞추기를 한 번 더 함
  const keptViews = kept.map(viewOf);
  const unmet = destination.districtCodes.length
    ? members.flatMap((m) => (includes.get(m.memberId) ?? []).filter((k) => !metIn(keptViews, k)).map((k) => ({ memberId: m.memberId, k })))
    : [];
  const unmetPlaces = unmet.filter((u) => u.k.rule.target !== 'area');
  const outsideAll = unmetPlaces.length
    ? await db
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
    : [];
  const unmetNames = unmetPlaces.filter((u) => isNameRule(u.k.rule)).map((u) => ({ memberId: u.memberId, rule: u.k.rule }));
  if (unmetNames.length && opts.matchNames) await askNames(unmetNames, await listOf(outsideAll));
  const outsideRows = outsideAll.filter((p) => !rejectReason(p));
  const inRegionViews = [...kept, ...outsideRows].map(viewOf);
  const nameMatches: RetrieveResult['nameMatches'] = [...nameRules, ...areaRules].flatMap((x) => {
    const ids = [...(named.get(x.rule) ?? [])];
    const districts = [...(areaPicked.get(x.rule) ?? [])];
    if (!ids.length && !districts.length) return [];
    const places = [...districts.map((d) => districtName.get(d) ?? d), ...ids.map((id) => titleOf.get(id) ?? id)];
    return [{ memberId: x.memberId, type: x.rule.type === 'avoid' ? ('avoid' as const) : ('include' as const), label: x.rule.label, keyword: x.rule.keyword!.trim(), places, ids, ...(districts.length ? { districts } : {}) }];
  });
  // 장소 이름 규칙: 이름이 같은 곳 중 숙소·가게가 아닌 곳이 있으면 숙소·가게는 꼭 지킬 곳으로 보지 않음 (10/27 사용자 결정, 이름 맞추기로 찾은 곳 포함)
  for (const list of includes.values())
    for (const k of list) {
      if (k.rule.target !== 'place' || !metIn(inRegionViews, k)) continue;
      const base = k.matches;
      k.matches = (v) => base(v) && !isBusiness(v.code);
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
  const toCandidate = (p: Row): Candidate => {
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
        if (v >= RETRIEVE.popularReasonMin) why.push('이름난 곳');
      }
      if (crowdScore !== null) {
        if (m.profile.weights.crowd) {
          const v = ((crowdScore - RETRIEVE.crowdNeutral) / RETRIEVE.crowdNeutral) * m.profile.weights.crowd * RETRIEVE.crowdRange;
          s += v;
          if (v >= RETRIEVE.crowdReasonMin) why.push(m.profile.weights.crowd > 0 ? '활기찬 날' : '한산한 날');
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
      code: p.lcls3,
      rest,
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
  const isMust = (c: Candidate) => Object.values(c.marks).some((ks) => ks.some((k) => k.kind === 'must'));
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
  const mineOf = new Map<string, Candidate[]>();
  for (const m of members) {
    const mine = [...scored].sort((a, b) => b.scores[m.memberId] - a.scores[m.memberId] || b.total - a.total || a.id.localeCompare(b.id));
    mineOf.set(m.memberId, mine);
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
  // 종류 꼭 지킬 것의 다음 후보 (몫 8곳과 따로, 그 사람 점수 순 그대로라 덜 알려진 곳 선호가 유지됨)
  for (const m of members) {
    for (const k of (includes.get(m.memberId) ?? []).filter((x) => x.rule.target === 'category')) {
      const more = mineOf.get(m.memberId)!.filter((c) => k.matches(viewById.get(c.id)!));
      for (const c of more.slice(RETRIEVE.mustKeepPerRule, RETRIEVE.mustKeepPerRule + RETRIEVE.mustKeepKindExtra)) {
        if (chosen.size >= RETRIEVE.poolSize) break;
        if (!add(c, m.memberId)) sameSpotDropped.push(c.name);
      }
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
    const codes = [...(areaPicked.get(u.k.rule) ?? [])];
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

  // 꼭 지킬 것(넣기)이 후보에 하나도 없으면 표시 없이 빠지지 않게 까닭과 함께 남김 (4단계 안건 메모). 여행지 밖 메모가 있는 규칙은 거기서 이미 알림
  // 여행지 전체를 가리켜 쓰지 않은 지역 규칙, 여행지 어디에도 맞는 곳이 없어 아무것도 거르지 않은 피하기 규칙도 메모로 알림 (조용히 효과가 없지 않게)
  const pool = [...candidates, ...lodgings];
  const rowViews = rows.map(viewOf);
  // 이름·지역 규칙인데 LLM 답을 받지 못함 (LLM 없음·하루 상한·실패·LLM_REPLAY에 녹화 없음): 코드가 글자로 대신 맞추지 않고 알림
  const noAnswer = (r: MustKeepRule) => (isNameRule(r) || isAreaRule(r)) && !answered.has(r);
  const missingRules: RetrieveResult['missingRules'] = [
    ...skippedRules,
    ...avoidRules
      .filter((a) => !rowViews.some(a.matches))
      .map((a) => ({ memberId: a.memberId, label: a.rule.label, reason: noAnswer(a.rule) ? NO_NAME_ANSWER : '여행지 자료에서 맞는 곳을 찾지 못해 적용하지 못함' })),
  ];
  for (const m of members) {
    for (const k of includes.get(m.memberId) ?? []) {
      if (pool.some((c) => c.marks[m.memberId]?.some((x) => x.kind === 'must' && x.label === k.rule.label))) continue;
      if (outsideRules.some((r) => r.memberId === m.memberId && r.label === k.rule.label)) continue;
      const blocked = [...rows, ...outsideAll].some((p) => rejectReason(p) && k.matches(viewOf(p)));
      missingRules.push({
        memberId: m.memberId,
        label: k.rule.label,
        reason: blocked ? '여행 날짜가 휴무이거나 다른 사람의 꼭 피할 것에 걸림' : noAnswer(k.rule) ? NO_NAME_ANSWER : '여행지 자료에서 찾지 못함',
      });
    }
  }
  const sources = ['tour_api'];
  if (pop.matched) sources.push('tour_rank');
  if (crw.scores.size) sources.push('tour_crowd');
  return {
    destination,
    dates,
    candidates,
    nights,
    lodgings,
    stages: [
      { label: '지역·후보 유형', count: rows.filter((p) => !isLodging(p)).length },
      { label: '축제 날짜·휴무일·꼭 피할 것을 거른 뒤', count: scored.length },
      { label: '고른 후보', count: candidates.length },
      { label: `숙소 후보 (${nights}박${nights ? `, 숙박 ${rows.filter(isLodging).length}곳 중` : ' · 당일치기라 뽑지 않음'})`, count: lodgings.length },
      ...(outsideSpots.size + outsideLodgings.size ? [{ label: '꼭 지킬 것이 여행지에 없어 같은 시·도에서 넣은 곳', count: outsideSpots.size + outsideLodgings.size }] : []),
      ...(nameMatches.length ? [{ label: '이름·지역 맞추기(LLM)로 맞춘 꼭 지킬 것·꼭 피할 것', count: nameMatches.length }] : []),
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
