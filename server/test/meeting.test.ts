import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { MemorySaver } from '@langchain/langgraph';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { llmRecorder } from '../src/llm/record.js';
import { EVAL } from '../src/meeting/evaluate.js';
import { createApp } from '../src/app.js';
import { categories, crowdFetches, llmRecords, llmUsage, members, placeRelations, places, regions, relatedFetches, routeCache } from '../src/db/schema.js';
import { hashToken } from '../src/lib/ids.js';
import { REVIEW, applyReview, reviewRequestOf, tallyReview } from '../src/meeting/review.js';
import { ruleCategories } from '../src/meeting/categories.js';
import { closedOn, hoursOn } from '../src/meeting/hours.js';
import { DESTINATION, DestinationUnavailable, destinationRequest, resolveDestination } from '../src/meeting/destination.js';
import { AREA_MATCH, type AreaAnswer, type AreaMatcher, type AreaRule, areaInput, areaMatcher, decodeAreas, savedAreaMatcher } from '../src/meeting/areas.js';
import { withSubDistricts } from '../src/meeting/regions.js';
import { NAME_MATCH, type NameMatcher, type NamePlace, type NameRule, SYSTEM, decodeNames, nameInput, nameMatcher, savedNameMatcher } from '../src/meeting/names.js';
import { type MemberInput, NO_NAME_ANSWER, RETRIEVE, retrieveCandidates } from '../src/meeting/retrieve.js';
import { isAreaRule, isNameRule, ruleMatcher } from '../src/meeting/rules.js';
import type { PersonaProfile } from '../src/persona/types.js';
import type { TourClient } from '../src/tour/client.js';
import { meetings, trips } from '../src/db/schema.js';
import { EventHub, LIVE, liveSocketServer } from '../src/meeting/live.js';
import { PICK, type PickResult, ensureOwnLimits, ownConflictIds, pickTables, savedPickFor } from '../src/meeting/pick.js';
import { REACT, agendaOf, overlapMinutes, reactBoard, reactionOf, reactionScore } from '../src/meeting/react.js';
import { eventsAfter, failInterruptedMeetings, pendingEventLanes, pruneMeetingCheckpoints, reopenTrip } from '../src/meeting/runs.js';
import { buildMeetingGraph } from '../src/meeting/graph.js';
import { meetingService } from '../src/meeting/service.js';
import { pruneRouteCache } from '../src/meeting/route.js';
import { checkpointPool } from '../src/db/client.js';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { sql } from 'drizzle-orm';
import { acceptReactions, reactRequest, reactWishes } from '../src/meeting/react-ai.js';
import type { Candidate, RetrieveResult } from '../src/meeting/retrieve.js';
import { MINSU, answersOf, areaAnswer, call, createTestApp, destinationLlm, fakeLlm, nameAnswer } from './helpers.js';
import { hashAccessKey, parseAccessKeys } from '../src/lib/access.js';

/** 4단계 AI 반응 호출 수: 다른 AI가 고른 곳이 보드에 하나라도 있는 사람마다 1회 (시험의 4명은 모두 바람 글이 있음) */
const reactCalls = (r: { members: { memberId: string }[]; board: { candidates: { proposedBy: string[] }[] } }) =>
  r.members.filter((m) => r.board.candidates.some((c) => !c.proposedBy.includes(`agt_${m.memberId.replace(/^mem_/, '')}`))).length;

/** 7단계 평가 가짜 답: 안마다 찬성, 요청 없음 */
const evalAnswer = (input: { plans: Record<string, string> }) => ({
  ...Object.fromEntries(Object.keys(input.plans).map((l) => [l.toLowerCase(), { why: '좋아하는 곳이 많아요', stance: '찬성' }])),
  comment: '둘 다 좋아요!',
  requests: [],
});
/** 7단계 평가에서 부른 LLM 수 (사람 확인을 기다리면 0) */
const evalCalls = (r: { evaluation: { members: { llmCalls: number }[] } | null }) => r.evaluation?.members.reduce((a, m) => a + m.llmCalls, 0) ?? 0;

const REGIONS = [
  ['26', '부산광역시', '200', '영도구'],
  ['26', '부산광역시', '290', '남구'],
  ['26', '부산광역시', '350', '해운대구'],
  ['26', '부산광역시', '500', '수영구'],
  ['26', '부산광역시', '110', '중구'],
  ['11', '서울특별시', '140', '중구'],
  ['12', '전남광주통합특별시', '110', '동구'],
  ['48', '경상남도', '330', '양산시'],
  ['41', '경기도', '610', '광주시'],
].map(([regionCode, regionName, districtCode, districtName]) => ({ regionCode, regionName, districtCode, districtName }));

type Seed = { id: string; type: number; title: string; lcls1: string; lcls3?: string; district: string; overview?: string; intro?: Record<string, string>; lat?: number; lng?: number };
const CATEGORIES = [
  ['EX050100', '체험관광', '웰니스관광', '온천 / 사우나 / 스파'],
  ['FD050100', '음식', '카페/ 찻집', '카페'],
  ['FD010100', '음식', '한식', '관광식당'],
  ['FD030200', '음식', '서양식', '피자, 햄버거, 샌드위치 및 유사음식'],
  ['NA020900', '자연관광', '자연경관(하천‧해양)', '해변. 해수욕장'],
  ['VE030100', '문화관광', '공원', '시민공원'],
  ['SH060200', '쇼핑', '시장', '상설시장'],
  ['NA010100', '자연관광', '자연경관(산)', '산, 고개, 오름, 봉우리'],
  ['AC010100', '숙박', '호텔', '호텔'],
  ['AC060200', '숙박', '호스텔', '게스트하우스'],
].map(([code, name1, name2, name3]) => ({ code, name1, name2, name3 }));
const SEEDS: Seed[] = [
  { id: 'p1', type: 12, title: '광안리해수욕장', lcls1: 'NA', lcls3: 'NA020900', district: '500', overview: '광안대교 야경이 보이는 바다', intro: { restdate: '연중무휴', usetime: '상시 개방' }, lat: 35.1532, lng: 129.119 },
  { id: 'p2', type: 12, title: '송정해수욕장', lcls1: 'NA', lcls3: 'NA020900', district: '350', overview: '한적한 바다', intro: { restdate: '연중무휴' }, lat: 35.1787, lng: 129.1997 },
  { id: 'p3', type: 12, title: '태종대온천찜질방', lcls1: 'EX', lcls3: 'EX050100', district: '200', overview: '온천과 찜질방', intro: { restdate: '연중무휴', usetime: '[온천] 05:00~22:00' }, lat: 35.0646, lng: 129.0788 },
  { id: 'p4', type: 39, title: '신창국밥 본점', lcls1: 'FD', lcls3: 'FD010100', district: '110', overview: '맑은 육수 돼지국밥', intro: { restdatefood: '매주 일요일', opentimefood: '09:00~21:00', firstmenu: '돼지국밥' }, lat: 35.101, lng: 129.0226 },
  { id: 'p5', type: 12, title: '오륙도', lcls1: 'NA', district: '290', overview: '바다 위 바위섬', intro: { restdate: '연중무휴' }, lat: 35.1001, lng: 129.124 },
  { id: 'p6', type: 12, title: '오륙도 등대', lcls1: 'VE', district: '290', overview: '등대', intro: { restdate: '연중무휴' }, lat: 35.1008, lng: 129.1245 },
  { id: 'p7', type: 15, title: '부산불꽃축제', lcls1: 'EV', lcls3: 'EV010200', district: '500', overview: '광안리 불꽃', intro: { eventstartdate: '20261107', eventenddate: '20261107' }, lat: 35.153, lng: 129.118 },
  { id: 'p8', type: 15, title: '여름 바다 축제', lcls1: 'EV', lcls3: 'EV010600', district: '350', overview: '여름 축제', intro: { eventstartdate: '20260801', eventenddate: '20260805' } },
  { id: 'p9', type: 39, title: '토요휴무식당', lcls1: 'FD', district: '350', overview: '맛집', intro: { restdatefood: '매주 토요일' } },
  { id: 'p10', type: 38, title: '국제시장', lcls1: 'SH', lcls3: 'SH060200', district: '110', overview: '전통 시장', intro: { restdateshopping: '연중무휴', opentime: '09:00~19:00' } },
  { id: 'p11', type: 39, title: '수변최고돼지국밥', lcls1: 'FD', lcls3: 'FD010100', district: '500', overview: '돼지국밥 전문점', intro: { restdatefood: '연중무휴' }, lat: 35.1567, lng: 129.1343 },
  { id: 'p12', type: 14, title: '부산시립미술관', lcls1: 'VE', district: '350', overview: '현대 미술관', intro: { restdateculture: '매주 월요일' } },
  { id: 'p13', type: 39, title: '온천천 카페', lcls1: 'FD', lcls3: 'FD050100', district: '350', overview: '온천천 산책로 옆 카페', intro: { restdatefood: '연중무휴' } },
  { id: 'p14', type: 39, title: '이재모피자', lcls1: 'FD', lcls3: 'FD030200', district: '350', overview: '피자', intro: { restdatefood: '연중무휴', treatmenu: '오븐스파게티' } },
  { id: 'p15', type: 39, title: '온천입구곰장어', lcls1: 'FD', lcls3: 'FD010100', district: '350', overview: '곰장어', intro: { restdatefood: '연중무휴' } },
  { id: 'p16', type: 12, title: '온천천시민공원', lcls1: 'VE', lcls3: 'VE030100', district: '350', overview: '온천천 산책로', intro: { restdate: '연중무휴' } },
  { id: 'p17', type: 38, title: '온천시장', lcls1: 'SH', lcls3: 'SH060200', district: '350', overview: '동래 온천장 시장', intro: { restdateshopping: '연중무휴' } },
  { id: 'p18', type: 12, title: '장산', lcls1: 'NA', lcls3: 'NA010100', district: '350', overview: '해운대 뒷산 등산로', intro: { restdate: '연중무휴' } },
  { id: 'p19', type: 38, title: '토요휴무상가', lcls1: 'SH', lcls3: 'SH060200', district: '350', overview: '상가', intro: { restdateshopping: '매주 토요일' } },
  { id: 'h1', type: 32, title: '광안호텔', lcls1: 'AC', lcls3: 'AC010100', district: '500', overview: '바다 앞 호텔', intro: { checkintime: '15:00' }, lat: 35.154, lng: 129.118 },
  { id: 'h2', type: 32, title: '해운대게스트하우스', lcls1: 'AC', lcls3: 'AC060200', district: '350', overview: '게스트하우스', intro: {} },
  { id: 'x1', type: 12, title: '서울 다른 곳', lcls1: 'NA', district: '140', overview: '서울' },
];

async function seedDb(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await db.insert(regions).values(REGIONS);
  await db.insert(categories).values(CATEGORIES);
  await db.insert(places).values(
    SEEDS.map((s) => ({
      contentId: s.id,
      contentTypeId: s.type,
      title: s.title,
      regionCode: s.id === 'x1' ? '11' : '26',
      districtCode: s.district,
      lcls1: s.lcls1,
      lcls3: s.lcls3 ?? null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      visible: true,
      listRaw: {},
      overview: s.overview ?? null,
      introRaw: s.intro ?? null,
      detailSyncedAt: new Date(),
    })),
  );
  // 연관 관광지: 2025-11 자료에서 광안리가 가장 많이 함께 찾은 곳
  await db.insert(relatedFetches).values({ baseYm: '202511', signguCd: '26500', rows: 3 });
  await db.insert(placeRelations).values([
    { baseYm: '202511', signguCd: '26500', tAtsCd: 'a', tAtsNm: '민락수변공원', rlteTatsCd: 'r1', rlteTatsNm: '광안리해수욕장', rlteSignguCd: '26500', rlteRank: 1 },
    { baseYm: '202511', signguCd: '26350', tAtsCd: 'b', tAtsNm: '해운대', rlteTatsCd: 'r1', rlteTatsNm: '광안리 해수욕장', rlteSignguCd: '26500', rlteRank: 3 },
    { baseYm: '202511', signguCd: '26350', tAtsCd: 'b', tAtsNm: '해운대', rlteTatsCd: 'r2', rlteTatsNm: '송정해수욕장', rlteSignguCd: '26350', rlteRank: 20 },
  ]);
}

const profile = (p: Partial<PersonaProfile>): PersonaProfile => ({
  placesPerDay: [3, 4],
  maxSteps: 15000,
  startTime: '09:30',
  endTime: null,
  freeMinutes: 30,
  weights: { price: 0, crowd: 0, popularity: 0 },
  maxMoveMinutes: null,
  maxCrowd: null,
  maxMealPrice: null,
  budgetPerPerson: null,
  avoidQueue: false,
  includes: [],
  avoids: [],
  likes: [],
  ...p,
});
const rule = (type: 'include' | 'avoid', keyword: string, label: string, target: 'category' | 'food' | 'place' | 'area', codes: string[] = []) => ({
  type,
  label,
  quote: label,
  keyword,
  target,
  codes,
  start: null,
  end: null,
  amount: null,
});
const MEMBERS: MemberInput[] = [
  { memberId: 'm1', nickname: '민수', title: '부지런한 리더', likes: ['like_night', 'like_sea'], dislikes: [], mustKeep: [], profile: profile({ weights: { price: 0, crowd: 0.6, popularity: 0.4 } }) },
  { memberId: 'm2', nickname: '지은', title: '반짝반짝 탐험가', likes: ['like_festival'], dislikes: [], mustKeep: [], profile: profile({}) },
  { memberId: 'm3', nickname: '현우', title: '꼼꼼한 맛집 플래너', likes: ['like_food'], dislikes: [], mustKeep: [rule('include', '돼지국밥', '돼지국밥 먹기', 'food'), rule('avoid', '시장', '시장은 빼기', 'category', ['SH060100', 'SH060200'])], profile: profile({}) },
  { memberId: 'm4', nickname: '서연', title: '느긋한 힐러', likes: ['like_spa', 'like_sea'], dislikes: ['dislike_crowd', 'dislike_walk'], mustKeep: [rule('include', '온천', '온천 가기', 'category', ['EX050100'])], profile: profile({ weights: { price: 0, crowd: -0.8, popularity: 0 }, maxCrowd: 80 }) },
];
const CONDITIONS = { destination: '부산', startDate: '2026-11-07', endDate: '2026-11-07', budgetPerPerson: null, transport: null, rules: { aiMinSatisfaction: 7, maxRounds: 5 } };
const DEST = { regionCode: '26', regionName: '부산광역시', districtCodes: [], label: '부산광역시' };

/** 가짜 집중률 API: 수영구(26500)만 광안리 85를 돌려주고 나머지 구는 0건 */
/** 시험용 이름 맞추기 (실제 LLM을 흉내 냄: 목록에서 이름에 그 말이 든 곳, 음식은 음식점의 메뉴도) — 시험 안에서만 글자를 비교함 */
const textNames: NameMatcher = async (rules, list) =>
  new Map(
    rules.map((r) => {
      const k = r.keyword.replace(/\s+/g, '');
      const hit = list.filter((p) => (r.target === 'food' ? p.isFood : true) && (p.title.replace(/\s+/g, '').includes(k) || (r.target === 'food' && !!p.menu?.replace(/\s+/g, '').includes(k))));
      return [r.key, hit.map((p) => p.id).slice(0, r.type === 'avoid' ? 4 : 2)];
    }),
  );

/** 시험용 지역 맞추기 (실제 LLM을 흉내 냄: 지역 말이 구·군 이름이면 그 구·군, 아니면 이름에 그 말이 든 장소) — 시험 안에서만 글자를 비교함 */
const textAreas: AreaMatcher = async (rules, districts, list) =>
  new Map(
    rules.map((r): [string, AreaAnswer] => {
      const w = r.keyword.replace(/\s+/g, '');
      const hit = districts.filter((d) => {
        const n = d.name.replace(/\s+/g, '');
        return w === n || w === n.replace(/(시|군|구)$/, '') || (w.length >= 2 && n.startsWith(w));
      });
      if (hit.length) return [r.key, { districts: hit.map((d) => d.code), ids: [] }];
      const place = list.find((p) => p.title.replace(/\s+/g, '').includes(w));
      return [r.key, { districts: [], ids: place ? [place.id] : [] }];
    }),
  );

function fakeCrowd() {
  const calls: string[] = [];
  const client: TourClient = {
    async call(_op, params) {
      calls.push(String(params.signguCd));
      if (params.signguCd !== '26500') return { items: [], totalCount: 0 };
      return { items: [{ baseYmd: '20261107', tAtsNm: '광안리해수욕장', cnctrRate: '85' }, { baseYmd: '20261108', tAtsNm: '광안리해수욕장', cnctrRate: '60' }], totalCount: 2 };
    },
  };
  return { client, calls };
}

describe('휴무일·영업시간 판독', () => {
  it('흔한 휴무일 문장을 읽고, 못 읽으면 unknown', () => {
    expect(closedOn('매주 일요일', '2026-11-08')).toBe('closed');
    expect(closedOn('매주 일요일', '2026-11-07')).toBe('open');
    expect(closedOn('연중무휴', '2026-11-08')).toBe('open');
    expect(closedOn('설·추석 당일', '2026-11-07')).toBe('open');
    expect(closedOn('매월 첫째 월요일', '2026-11-02')).toBe('closed');
    expect(closedOn('매월 첫째 월요일', '2026-11-09')).toBe('open');
    expect(closedOn('※ 점포별 상이함', '2026-11-07')).toBe('unknown');
    expect(closedOn('', '2026-11-07')).toBe('unknown');
  });

  it('계절·달별 영업시간은 그 달 구간을 고름', () => {
    expect(hoursOn('[하절기(3월~10월)]04:00~24:00[동절기(11월~2월)]05:00~24:00', 11)).toEqual({ open: 300, close: 1440 });
    expect(hoursOn('[해운대 해변열차] - 동절기(11, 12, 1, 2월) 09:00~19:00 - 간절기(3, 4, 10월) 09:00~19:30', 10)).toEqual({ open: 540, close: 1170 });
    expect(hoursOn('매년 6월~9월 09:00~18:00', 11)).toBeNull();
    expect(hoursOn('상시 개방', 5)).toEqual({ open: 0, close: 1440 });
    expect(hoursOn('- 09:00~21:00<br>- 마지막 주문 20:30', 5)).toEqual({ open: 540, close: 1260 });
    // 구간이 여러 개면 가장 이른 시작 ~ 가장 늦은 끝 (10/15 전국 확인: 조식 구간만 읽어 늦게 시작하는 사람에게 ✕가 잘못 붙던 문제)
    expect(hoursOn('조식 06:30~10:00중식 12:00~14:30석식 18:00~21:00', 10)).toEqual({ open: 390, close: 1260 });
    expect(hoursOn('11:00~15:00, 17:00~02:00', 10)).toEqual({ open: 660, close: 120 });
  });
});

describe('꼭 지킬 것 맞추기 (코드·이름만, 낱말 해석 없음)', () => {
  const place = (title: string, extra: Partial<{ code: string; districtCode: string; isFood: boolean; menu: string }> = {}) => ({
    title,
    code: extra.code ?? null,
    districtCode: extra.districtCode ?? null,
    isFood: extra.isFood ?? false,
    menu: extra.menu ?? null,
  });

  it('장소·음식 이름 규칙은 코드가 글자로 맞추지 않음 (10/29 사용자 결정 \'가\': 이름 맞추기 LLM이 고른 장소 번호로만)', () => {
    expect(isNameRule(rule('include', '이재모피자', '이재모피자 가기', 'place'))).toBe(true);
    expect(isNameRule(rule('include', '국밥', '국밥 먹기', 'food'))).toBe(true);
    expect(isNameRule(rule('include', '온천', '온천', 'category', ['EX050100']))).toBe(false);
    expect(isNameRule(rule('include', '해운대', '해운대 가기', 'area'))).toBe(false);
    // 이름이 통째로 같아도, 메뉴에 그 음식이 있어도 코드는 맞추지 않음
    expect(ruleMatcher(rule('include', '이재모피자', '이재모피자 가기', 'place'))(place('이재모피자 본점', { isFood: true }))).toBe(false);
    expect(ruleMatcher(rule('include', '국밥', '국밥 먹기', 'food'))(place('민락국밥', { isFood: true, menu: '돼지국밥' }))).toBe(false);
    // target이 없는 예전 규칙도 글자로 맞추지 않음
    expect(ruleMatcher({ ...rule('include', '돼지국밥', '돼지국밥 먹기', 'food'), target: undefined })(place('돼지국밥집', { isFood: true, menu: '돼지국밥' }))).toBe(false);
  });

  it('코드는 종류(공식 분류 코드)만 맞추고, 지역 규칙은 글자로 맞추지 않음 (10/29: 지역은 2단계 지역 맞추기 LLM이 구·군 목록에서 고름)', () => {
    const spa = ruleMatcher(rule('include', '온천', '온천', 'category', ['EX050100']));
    expect(spa(place('해운대온천센터', { code: 'EX050100' }))).toBe(true);
    expect(spa(place('온천천시민공원', { code: 'VE030100' }))).toBe(false);
    const area = rule('include', '해운대', '해운대 가기', 'area');
    expect(isAreaRule(area)).toBe(true);
    expect(ruleMatcher(area)(place('장산', { districtCode: '350' }))).toBe(false);
  });
});

// PGlite DB를 새로 만드는 시험이라 느린 CI에서는 5초를 넘음 (10/27 GitHub 5.1초) → 이 묶음만 20초
describe('여행지 확인 (10/29: 방장이 쓴 여행지를 LLM이 공식 지역 목록에서 고름)', { timeout: 20_000 }, () => {
  const ok = { reserve: async () => true };
  it('LLM이 고른 목록 번호를 법정동 코드로 바꿈: 시·도 전체, 시·군·구, 같은 이름이 여러 곳이면 다시 쓰게 함', async () => {
    const { db } = await createTestApp();
    await db.insert(regions).values(REGIONS);
    const llm = destinationLlm(); // 시험용 흉내 (예전 글자 규칙): 서버 코드는 번호만 읽음
    const go = (text: string) => resolveDestination(db, text, { llm, ...ok });
    expect(await go('부산')).toMatchObject({ regionCode: '26', districtCodes: [], label: '부산광역시' });
    expect(await go('부산 해운대구')).toMatchObject({ regionCode: '26', districtCodes: ['350'], label: '부산광역시 해운대구' });
    expect(await go('해운대')).toMatchObject({ regionCode: '26', districtCodes: ['350'] });
    await expect(go('광주')).rejects.toThrow(/여러 곳에 있음 '광주'.*경기도 광주시/);
    expect(await go('경기 광주')).toMatchObject({ regionCode: '41', districtCodes: ['610'] });
    expect(await go('경남')).toMatchObject({ regionCode: '48' });
    await expect(go('중구')).rejects.toThrow(/여러 곳/);
    await expect(go('없는마을')).rejects.toThrow(/찾지 못함/);
  });

  it('지역 표는 설명문 끝에 붙여 매번 같게 두고(시·도마다 전체 한 줄), 입력은 띄어쓰기만 모음 · 여러 시·도에 걸친 답·없는 번호는 받지 않음', async () => {
    const { db } = await createTestApp();
    await db.insert(regions).values(REGIONS);
    const { lines, req } = await destinationRequest(db, '  부산   해운대구 ');
    expect(req.input).toEqual({ destination: '부산 해운대구' });
    expect(req.system).toContain('|부산광역시|전체');
    expect(req.system).toContain('|부산광역시|해운대구');
    const no = (region: string, district: string) => lines.find((l) => l.regionName === region && (l.districtName ?? '전체') === district)!.no;
    const answer = (picks: string[]) => fakeLlm(() => ({ evidence: '-', picks, candidates: [] }));
    await expect(resolveDestination(db, '중구', { llm: answer([no('부산광역시', '중구'), no('서울특별시', '중구')]), ...ok })).rejects.toThrow(/여러 곳/);
    await expect(resolveDestination(db, '부산', { llm: answer(['9999']), ...ok })).rejects.toThrow(/찾지 못함/);
    expect(await resolveDestination(db, '부산 바다', { llm: answer([no('부산광역시', '전체'), no('부산광역시', '수영구')]), ...ok })).toMatchObject({ districtCodes: [] }); // 전체가 있으면 시·도 전체
    await db.insert(regions).values([
      { regionCode: '52', regionName: '전북특별자치도', districtCode: '110', districtName: '전주시' },
      { regionCode: '52', regionName: '전북특별자치도', districtCode: '111', districtName: '전주시 완산구' },
      { regionCode: '52', regionName: '전북특별자치도', districtCode: '113', districtName: '전주시 덕진구' },
    ]);
    const jeonju = await destinationRequest(db, '전주');
    const city = jeonju.lines.find((l) => l.districtName === '전주시')!.no;
    expect(await resolveDestination(db, '전주', { llm: answer([city]), ...ok })).toMatchObject({ regionCode: '52', districtCodes: ['110', '111', '113'], label: '전북특별자치도 전주시' }); // 장소는 구 코드에 붙어 있음
  });

  it('LLM을 쓸 수 없으면(없음·하루 상한·실패) 코드가 글자로 대신 찾지 않고 확인 못 함 · 녹화된 같은 글은 LLM 없이 다시 씀', async () => {
    const { db } = await createTestApp();
    await db.insert(regions).values(REGIONS);
    await expect(resolveDestination(db, '부산', { llm: null, ...ok })).rejects.toBeInstanceOf(DestinationUnavailable);
    const unused = destinationLlm();
    await expect(resolveDestination(db, '부산', { llm: unused, reserve: async () => false })).rejects.toBeInstanceOf(DestinationUnavailable);
    expect(unused.calls).toBe(0);
    const broken = fakeLlm(() => {
      throw new Error('boom');
    });
    await expect(resolveDestination(db, '부산', { llm: broken, ...ok })).rejects.toBeInstanceOf(DestinationUnavailable);
    const fill = llmRecorder(db, 'fake', 'fill');
    expect(await resolveDestination(db, '부산', { llm: destinationLlm(), recorder: fill, ...ok })).toMatchObject({ regionCode: '26' });
    expect(await resolveDestination(db, '부산', { llm: null, recorder: llmRecorder(db, 'fake', 'only'), ...ok })).toMatchObject({ regionCode: '26' });
  });

  it('조건 저장: 여행지를 확인하지 못하면 503 AI_UNAVAILABLE (여러 곳·없는 곳은 400)', async () => {
    const { app, db } = await createTestApp({ destinationLlm: null });
    await db.insert(regions).values(REGIONS);
    const demo = await call(app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
    const res = await call(app, 'PUT', `/trips/${demo.body.trip.id}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, demo.body.token);
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'AI_UNAVAILABLE', message: DESTINATION.unavailable.noLlm }); // 다시 보내도 안 되는 까닭을 알림 (AI 0번 모드·키 없음)
  });
});

describe('지역 맞추기 (2단계, 10/29: 지역 조건은 LLM이 구·군 목록 또는 장소 목록에서 고름)', () => {
  const rules: AreaRule[] = [
    { key: 'a', type: 'include', label: '서면 근처', keyword: '서면', said: '서면 근처에서 놀고 싶어요' },
    { key: 'b', type: 'avoid', label: '해운대 빼기', keyword: '해운대', said: '해운대는 너무 붐벼서 빼 주세요' },
    { key: 'c', type: 'include', label: '한옥마을 걷기', keyword: '한옥마을', said: '한옥마을에서 한복 입고 걷기' },
  ];
  const districts = [
    { code: '230', name: '부산진구' },
    { code: '350', name: '해운대구' },
  ];
  const list: NamePlace[] = [{ id: 'hanok', title: '전주 한옥마을', category: '민속마을', district: '완산구', isFood: false, menu: null, summary: null, popularity: 90 }];

  it('사람이 쓴 말 그대로·구·군 목록(A)·장소 목록(P)을 보내고, 답의 번호만 구·군 코드·장소 id로 되돌림 (빈칸·없는 번호는 맞는 곳 없음)', () => {
    const { areaCodes, placeCodes, input } = areaInput(rules, districts, list);
    expect(input.rules).toEqual(['1|넣기|서면 근처에서 놀고 싶어요', '2|피하기|해운대는 너무 붐벼서 빼 주세요', '3|넣기|한옥마을에서 한복 입고 걷기']);
    expect(input.areas).toBe('A1|부산진구\nA2|해운대구');
    expect(input.places).toContain('전주 한옥마을');
    const p = [...placeCodes].find(([, id]) => id === 'hanok')![0];
    const back = decodeAreas({ matches: [{ rule: 1, evidence: '-', pick: 'a1' }, { rule: 2, evidence: '-', pick: 'Z9' }, { rule: 3, evidence: '-', pick: p }] }, rules, areaCodes, placeCodes);
    expect(back.get('a')).toEqual({ districts: ['230'], ids: [] });
    expect(back.get('b')).toEqual({ districts: [], ids: [] });
    expect(back.get('c')).toEqual({ districts: [], ids: ['hanok'] });
  });

  it('LLM은 회의 1번에 AREA_MATCH.maxCalls번까지, 실패·상한이면 답 없음 · 지난 회의에서 맞춘 지역은 LLM 없이 다시 씀 (지금 목록에 있는 것만)', async () => {
    const llm = fakeLlm((input) => ({ matches: (input.rules as string[]).map((_, i) => ({ rule: i + 1, evidence: '없음', pick: '' })) }));
    const lots: AreaRule[] = Array.from({ length: AREA_MATCH.maxRules * (AREA_MATCH.maxCalls + 1) }, (_, i) => ({ key: `k${i}`, type: 'include', label: `동네${i}`, keyword: `동네${i}`, said: `동네${i} 쪽` }));
    const match = areaMatcher(llm, async () => true);
    expect((await match(lots, districts, list)).size).toBe(AREA_MATCH.maxRules * AREA_MATCH.maxCalls);
    expect(llm.calls).toBe(AREA_MATCH.maxCalls);
    const broken = fakeLlm(() => {
      throw new Error('boom');
    });
    expect((await areaMatcher(broken, async () => true)(rules, districts, list)).size).toBe(0);
    const saved = savedAreaMatcher([
      { type: 'include', label: '서면 근처', keyword: '서면', places: ['부산진구'], ids: [], districts: ['230'] },
      { type: 'include', label: '한옥마을 걷기', keyword: '한옥마을', places: ['전주 한옥마을'], ids: ['없어진곳'] },
    ]);
    const quiet = fakeLlm(() => ({ matches: [] }));
    const out = await areaMatcher(quiet, async () => true, { saved })(rules.slice(0, 1), districts, list);
    expect(out.get('a')).toEqual({ districts: ['230'], ids: [] });
    expect(quiet.calls).toBe(0);
    expect((await saved(rules.slice(2), districts, list)).size).toBe(0); // 기록의 장소가 지금 목록에 없으면 답하지 않은 것으로
  });

  it('구가 있는 시를 고르면 그 아래 구도 함께 (공식 지역 표의 코드 앞 두 자리·이름으로만, 이름이 다른 군은 넣지 않음)', () => {
    const table = [
      { districtCode: '110', districtName: '전주시' },
      { districtCode: '111', districtName: '전주시 완산구' },
      { districtCode: '113', districtName: '전주시 덕진구' },
      { districtCode: '115', districtName: '가짜군' },
      { districtCode: '710', districtName: '완주군' },
    ];
    expect(withSubDistricts(['110'], table).sort()).toEqual(['110', '111', '113']);
    expect(withSubDistricts(['710'], table)).toEqual(['710']);
  });

  it('2단계: 지역 조건이 장소를 가리키면 그 장소가 꼭 지킬 곳, 답이 없으면(LLM 없음) 코드가 글자로 대신 찾지 않고 메모', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const spa: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [rule('include', '태종대온천찜질방', '태종대온천찜질방에서 쉬기', 'area')] };
    const asked: AreaRule[] = [];
    const placeOnly: AreaMatcher = async (r, d, l) => {
      asked.push(...r);
      return textAreas(r, d, l);
    };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [spa], crowdClient: null, matchNames: textNames, matchAreas: placeOnly, today: '2026-11-01' });
    expect(asked.map((x) => x.said)).toEqual(['태종대온천찜질방에서 쉬기']); // 사람이 쓴 말(카드의 quote)을 그대로 보냄
    expect(r.candidates.find((c) => c.name === '태종대온천찜질방')?.marks.m7).toContainEqual({ kind: 'must', label: '태종대온천찜질방에서 쉬기' });
    expect(r.nameMatches).toContainEqual(expect.objectContaining({ type: 'include', keyword: '태종대온천찜질방', places: ['태종대온천찜질방'] }));
    const none = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [spa], crowdClient: null, matchNames: textNames, today: '2026-11-01' });
    expect(none.missingRules).toEqual([{ memberId: 'm7', label: '태종대온천찜질방에서 쉬기', reason: NO_NAME_ANSWER }]);
  });
});

describe('후보 찾기 (2단계, 코드)', () => {
  it('축제 날짜·휴무일·꼭 피할 것을 거르고, 같은 곳은 하나만 남기고, 사람별 점수를 매김', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const crowd = fakeCrowd();
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    const names = r.candidates.map((c) => c.name);
    const reasons = Object.fromEntries(r.excluded.map((e) => [e.reason, e.examples]));
    expect(reasons['축제가 여행 날짜에 열리지 않음']).toEqual(['여름 바다 축제']);
    expect(reasons['여행 날짜가 휴무일']).toEqual(['토요휴무식당', '토요휴무상가']); // 쇼핑은 휴무일 칸 이름이 다름
    expect(reasons['누군가 꼭 피할 것에 걸림']).toEqual(['국제시장', '온천시장']); // 분류가 상설시장인 곳만
    expect(names).toContain('부산불꽃축제');
    expect(names).not.toContain('서울 다른 곳');
    expect(names.filter((n) => n.startsWith('오륙도'))).toHaveLength(1);

    const by = Object.fromEntries(r.candidates.map((c) => [c.name, c]));
    expect(by['광안리해수욕장']).toMatchObject({ popularity: 100, crowd: 85 });
    expect(by['송정해수욕장'].popularity).toBeLessThan(100);
    expect(by['태종대온천찜질방'].crowd).toBeNull();
    // 서연: 온천은 꼭 지킬 것(+10) + 좋아요(+3), 광안리는 혼잡 85 > 80이라 감점
    expect(by['태종대온천찜질방'].scores.m4).toBeGreaterThanOrEqual(13);
    expect(by['태종대온천찜질방'].forMembers).toContain('m4');
    expect(by['광안리해수욕장'].reasons.m4).toContain('붐빔 예측 85 (붐비는 곳 싫어요)');
    expect(by['신창국밥 본점'].reasons.m3).toEqual(['좋아요: 맛집', '꼭 지킬 것: 돼지국밥 먹기']); // 이름 맞추기(시험에서는 textNames가 AI를 흉내): 메뉴
    expect(by['수변최고돼지국밥'].reasons.m3).toContain('꼭 지킬 것: 돼지국밥 먹기'); // 이름 맞추기: 가게 이름
    // '온천'은 공식 분류가 '온천 / 사우나 / 스파'인 곳만: 이름에 온천이 있는 카페·식당·공원, 메뉴에 '스파게티'가 있는 식당은 아님
    for (const n of ['온천천 카페', '이재모피자', '온천입구곰장어', '온천천시민공원']) {
      expect(by[n].reasons.m4.some((w) => w.startsWith('꼭 지킬 것'))).toBe(false);
      expect(by[n].reasons.m4.some((w) => w.includes('온천·스파'))).toBe(false);
    }
    expect(by['온천천 카페'].category).toBe('카페');
    expect(by['장산'].reasons.m4).toContain('싫어요: 오래 걷기'); // 산 분류
    expect(by['광안리해수욕장'].reasons.m1).toContain('좋아요: 바다'); // 해변 분류
    expect(r.sources).toEqual(['tour_api', 'tour_rank', 'tour_crowd']);
    expect(r.popularity.baseYm).toBe('202511');

    // 같은 날 다시 하면 집중률은 받아 둔 것을 씀 (API 호출 없음)
    const before = crowd.calls.length;
    const again = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    expect(crowd.calls.length).toBe(before);
    expect(again.crowd.fetched).toEqual([]);
    expect(again.crowd.cached).toContain('26500');
    expect((await db.select().from(crowdFetches)).length).toBe(REGIONS.filter((x) => x.regionCode === '26').length);

    // 동시에 같은 지역을 찾아도 구·군마다 한 번만 부름 (먼저 시작한 호출을 함께 기다림)
    const twin = fakeCrowd();
    await Promise.all([1, 2].map(() => retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: twin.client, matchNames: textNames, matchAreas: textAreas, today: '2026-11-02' })));
    expect(twin.calls).toHaveLength(new Set(twin.calls).size);
    expect(twin.calls.length).toBe(REGIONS.filter((x) => x.regionCode === '26').length);
  });

  it('사람 몫은 좋아요 보기를 돌아가며 채움 (한 가지 좋아요로 8곳이 다 차지 않음)', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    // 이름순으로 앞서는 해변 10곳: 점수 순으로만 고르면 바다만 8곳이 되어 축제가 빠짐
    await db.insert(places).values(
      Array.from({ length: 10 }, (_, i) => ({
        contentId: `a${i}`,
        contentTypeId: 12,
        title: `시험해변${i}`,
        regionCode: '26',
        districtCode: '500',
        lcls1: 'NA',
        lcls3: 'NA020900',
        lat: 35 + i * 0.01,
        lng: 129,
        visible: true,
        listRaw: {},
        introRaw: { restdate: '연중무휴' },
        detailSyncedAt: new Date(),
      })),
    );
    const fan: MemberInput = { ...MEMBERS[1], memberId: 'm9', likes: ['like_sea', 'like_festival'] };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    const share = r.candidates.filter((c) => c.forMembers.includes('m9'));
    expect(share).toHaveLength(8);
    expect(share.map((c) => c.name)).toContain('부산불꽃축제');
  });

  it('종류 꼭 지킬 것은 몫 8곳과 따로 그 사람 점수 순 다음 후보 2곳을 더 넣음 (좋아요로 몫이 찬 사람도 3단계 AI가 소개글로 고를 곳이 생김)', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const spot = (contentId: string, title: string, contentTypeId: number, lcls1: string, lcls3: string, i: number) => ({
      contentId,
      contentTypeId,
      title,
      regionCode: '26',
      districtCode: '500',
      lcls1,
      lcls3,
      lat: 35.1 + i * 0.01,
      lng: 129.05,
      visible: true,
      listRaw: {},
      introRaw: { restdate: '연중무휴', restdateshopping: '연중무휴' },
      detailSyncedAt: new Date(),
    });
    // 시장 6곳 + 해변 10곳: 바다 좋아요가 몫을 채우면 꼭 지킬 것(시장)은 2곳만 몫에 들어감
    await db.insert(places).values([
      ...Array.from({ length: 6 }, (_, i) => spot(`mk${i}`, `시험시장${i}`, 38, 'SH', 'SH060200', i)),
      ...Array.from({ length: 10 }, (_, i) => spot(`sb${i}`, `시험해변${i}`, 12, 'NA', 'NA020900', i)),
    ]);
    const marketGoer: MemberInput = { ...MEMBERS[1], memberId: 'm7', likes: ['like_sea'], mustKeep: [rule('include', '시장', '시장 구경하기', 'category', ['SH060200'])] };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [marketGoer], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    const mine = r.candidates.filter((c) => c.forMembers.includes('m7'));
    const must = mine.filter((c) => c.reasons.m7.some((w) => w.startsWith('꼭 지킬 것')));
    expect(must).toHaveLength(RETRIEVE.mustKeepPerRule + RETRIEVE.mustKeepKindExtra);
    expect(mine).toHaveLength(RETRIEVE.perMember + RETRIEVE.mustKeepKindExtra);
    expect(mine.filter((c) => c.reasons.m7.some((w) => w.startsWith('좋아요')))).toHaveLength(RETRIEVE.perMember - RETRIEVE.mustKeepPerRule); // 몫의 좋아요 칸은 줄지 않음
  });

  it('쇼핑(유형 38)도 후보: 시장은 쇼핑 좋아요에 맞고, 분류표는 후보 장소가 쓰는 분류만 보냄', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const shopper: MemberInput = { ...MEMBERS[1], memberId: 'm8', likes: ['like_shopping'] };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [shopper], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    const by = Object.fromEntries(r.candidates.map((c) => [c.name, c]));
    expect(by['국제시장']).toMatchObject({ type: 38, category: '상설시장', hours: '09:00~19:00' });
    expect(by['국제시장'].reasons.m8).toContain('좋아요: 쇼핑');
    expect(by['국제시장'].forMembers).toContain('m8');

    // 장소가 없는 분류(템플스테이)와 숨긴 장소만 쓰는 분류(수산시장)는 성향 LLM에 보내지 않음
    await db.insert(categories).values([
      { code: 'EX040100', name1: '체험관광', name2: '산사체험', name3: '템플스테이' },
      { code: 'SH060300', name1: '쇼핑', name2: '시장', name3: '수산시장' },
    ]);
    await db.insert(places).values({ contentId: 'hidden1', contentTypeId: 38, title: '숨긴시장', regionCode: '26', districtCode: '110', lcls1: 'SH', lcls3: 'SH060300', visible: false, listRaw: {} });
    const offered = (await ruleCategories(db)).map((c) => c.code);
    expect(offered).toContain('SH060200');
    expect(offered).toContain('EX050100');
    expect(offered).not.toContain('EX040100');
    expect(offered).not.toContain('SH060300');
  });

  it('숙소는 1박 이상일 때만 40곳과 따로 뽑고, 꼭 피할 것(분류 코드)을 지킴', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const day = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    expect(day).toMatchObject({ nights: 0, lodgings: [] });
    expect(day.candidates.some((c) => c.type === 32)).toBe(false);

    const twoDays = { ...CONDITIONS, endDate: '2026-11-08' };
    const noHostel: MemberInput = { ...MEMBERS[3], mustKeep: [...MEMBERS[3].mustKeep, rule('avoid', '게스트하우스', '게스트하우스 빼기', 'category', ['AC0602'])] };
    const r = await retrieveCandidates(db, { conditions: twoDays, destination: DEST, members: [...MEMBERS.slice(0, 3), noHostel], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    expect(r.nights).toBe(1);
    expect(r.lodgings.map((c) => c.name)).toEqual(['광안호텔']);
    expect(r.candidates.some((c) => c.type === 32)).toBe(false); // 40곳에는 넣지 않음
    expect(r.excluded.find((e) => e.reason === '누군가 꼭 피할 것에 걸림')?.count).toBe(4); // 시장 3곳 + 게스트하우스
  });

  it('40곳이 모두 누군가의 몫이어도 음식점 최소 수는 채움 (꼭 지킬 것은 빼지 않음)', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    // 바다만 좋아하는 4명 + 해변 60곳: 사람 몫과 합계 상위가 모두 해변으로 차는 경우
    await db.insert(places).values(
      Array.from({ length: 60 }, (_, i) => ({
        contentId: `s${i}`, contentTypeId: 12, title: `바다${i}`, regionCode: '26', districtCode: '500', lcls1: 'NA', lcls3: 'NA020900',
        lat: 35 + i * 0.01, lng: 129, visible: true, listRaw: {}, introRaw: { restdate: '연중무휴' }, detailSyncedAt: new Date(),
      })),
    );
    const seaLovers = MEMBERS.map((m) => ({ ...m, likes: ['like_sea'], dislikes: [], mustKeep: m.memberId === 'm4' ? m.mustKeep : [] }));
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: seaLovers, crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    const foods = r.candidates.filter((c) => c.type === 39);
    expect(r.candidates).toHaveLength(40);
    expect(foods.length).toBe(5); // 영업하는 음식점 5곳 전부 (최소 6곳보다 적게 있음)
    expect(r.candidates.map((c) => c.name)).toContain('태종대온천찜질방'); // 서연의 꼭 지킬 것은 남음
  });

  it('장소·음식 넣기 규칙을 이름으로 못 찾으면 이름 맞추기(LLM 1회)로 같은 곳을 꼭 지킬 곳으로 넣고, 그래도 없으면 까닭을 남김', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    await db.insert(places).values({
      contentId: 'xsky', contentTypeId: 12, title: '부산엑스더스카이', regionCode: '26', districtCode: '350', lcls1: 'VE', lcls3: 'VE010200',
      lat: 35.16, lng: 129.17, visible: true, listRaw: {}, introRaw: { restdate: '연중무휴' }, detailSyncedAt: new Date(),
    });
    const fan: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [rule('include', '엘시티 전망대', '엘시티 전망대 가기', 'place'), rule('include', '없는곳', '없는곳 가기', 'place')] };
    const asked: NameRule[][] = [];
    const matchNames: NameMatcher = async (rules, list) => {
      asked.push([...rules]);
      expect(list.some((p) => p.title === '부산엑스더스카이')).toBe(true);
      // 엘시티 전망대 → 부산엑스더스카이 (목록에 없는 id는 버림), 없는곳 → 맞는 곳 없음
      return new Map([
        [rules.find((r) => r.keyword === '엘시티 전망대')!.key, ['xsky', '목록에없는id']],
        [rules.find((r) => r.keyword === '없는곳')!.key, []],
      ]);
    };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01', matchNames });
    expect(asked).toHaveLength(1); // 이름 규칙을 한 번에 보냄
    expect(asked[0].map((x) => x.keyword)).toEqual(['엘시티 전망대', '없는곳']);
    expect(r.candidates.find((c) => c.name === '부산엑스더스카이')?.marks.m7).toContainEqual({ kind: 'must', label: '엘시티 전망대 가기' });
    expect(r.nameMatches).toEqual([{ memberId: 'm7', type: 'include', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', places: ['부산엑스더스카이'], ids: ['xsky'] }]);
    expect(r.missingRules).toEqual([{ memberId: 'm7', label: '없는곳 가기', reason: '여행지 자료에서 찾지 못함' }]);
    // 4단계에 메모로 보임 (AI가 맞춘 곳은 보드에 올라도 사람 확인 안건으로 올리지 않음: REACT.nameMatchAgenda 꺼짐)
    const board = reactBoard({ candidates: [], agenda: [] }, r, [fan]);
    expect(board.agenda.map((a) => a.text)).toContain(`${fan.nickname}의 꼭 지킬 것 '없는곳 가기' — 여행지 자료에서 찾지 못함`);
    expect(board.agenda.map((a) => a.text)).toContain(`${fan.nickname}의 꼭 지킬 것 '엘시티 전망대' → 부산엑스더스카이 (AI가 맞춤)`);
    const picked = reactBoard({ candidates: [{ placeId: 'plc_xsky', name: '부산엑스더스카이', lat: null, lng: null, proposedBy: ['agt_m7'], reactions: [] }], agenda: [] }, r, [fan]);
    expect(REACT.nameMatchAgenda).toBe(false);
    expect(picked.agenda.filter((a) => a.placeId !== null)).toEqual([]);
    expect(picked.agenda.map((a) => a.text)).toContain(`${fan.nickname}의 꼭 지킬 것 '엘시티 전망대' → 부산엑스더스카이 (AI가 맞춤)`);
    // 이름 맞추기가 없으면(LLM 없음·상한·AI 0번 모드에 녹화 없음) 코드가 글자로 대신 맞추지 않고 둘 다 메모로 남김
    const plain = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01' });
    expect(plain.nameMatches).toEqual([]);
    expect(plain.missingRules).toEqual([
      { memberId: 'm7', label: '엘시티 전망대 가기', reason: NO_NAME_ANSWER },
      { memberId: 'm7', label: '없는곳 가기', reason: NO_NAME_ANSWER },
    ]);
    // 이름이 통째로 같은 곳(태종대온천찜질방)도 코드가 글자로 찾지 않고 AI에 물음
    const found: MemberInput = { ...MEMBERS[1], memberId: 'm8', mustKeep: [rule('include', '태종대온천찜질방', '찜질방 가기', 'place')] };
    let calls = 0;
    const counting: NameMatcher = async () => {
      calls++;
      return new Map();
    };
    const silent = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [found], crowdClient: null, today: '2026-11-01', matchNames: counting });
    expect(calls).toBe(1);
    expect(silent.candidates.some((c) => c.marks.m8?.some((k) => k.kind === 'must'))).toBe(false);
  });

  it('꼭 피할 것의 장소 이름도 AI가 맞춘 곳만 거르고, 맞춘 곳은 메모로 보임 (코드는 이름 글자로 거르지 않음)', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const hater: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [rule('avoid', '태종대온천찜질방', '찜질방은 빼 주세요', 'place')] };
    const kinds: string[] = [];
    const avoidOnly: NameMatcher = async (rules, list) => {
      kinds.push(...rules.map((x) => x.type));
      return textNames(rules, list);
    };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [hater], crowdClient: null, today: '2026-11-01', matchNames: avoidOnly });
    expect(kinds).toEqual(['avoid']);
    expect(r.candidates.some((c) => c.name === '태종대온천찜질방')).toBe(false);
    expect(r.excluded.find((e) => e.reason === '누군가 꼭 피할 것에 걸림')?.examples).toContain('태종대온천찜질방');
    expect(r.nameMatches.map((n) => [n.type, n.places])).toEqual([['avoid', ['태종대온천찜질방']]]);
    const board = reactBoard({ candidates: [], agenda: [] }, r, [hater]);
    expect(board.agenda.map((a) => a.text)).toContain(`${hater.nickname}의 꼭 피할 것 '태종대온천찜질방' → 후보에서 뺀 곳: 태종대온천찜질방 (AI가 맞춤)`);
    // AI 답이 없으면 거르지 않고 메모로 알림 (글자가 같은 곳도 그대로 후보에 남음)
    const none = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [hater], crowdClient: null, today: '2026-11-01' });
    expect(none.candidates.some((c) => c.name === '태종대온천찜질방')).toBe(true);
    expect(none.missingRules).toEqual([{ memberId: 'm7', label: '찜질방은 빼 주세요', reason: NO_NAME_ANSWER }]);
  });

  it('target이 없는 예전 카드 규칙은 쓰지 않고 메모로 알림 (장소인지 음식인지 몰라 AI에도 묻지 않음)', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const old: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [{ ...rule('include', '돼지국밥', '돼지국밥 먹기', 'food'), target: undefined }] };
    let calls = 0;
    const counting: NameMatcher = async () => {
      calls++;
      return new Map();
    };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [old], crowdClient: null, today: '2026-11-01', matchNames: counting });
    expect(calls).toBe(0);
    expect(r.missingRules).toEqual([{ memberId: 'm7', label: '돼지국밥 먹기', reason: '예전 성향 카드의 규칙이라 쓰지 않음 (성향을 다시 내면 쓰임)' }]);
  });

  it('여행지 밖 장소가 편도 상한보다 멀면 넣지 않고 가장 가까운 곳의 시간만 안건 메모로 남김', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    // 같은 시·도의 다른 구에 있지만 여행지에서 약 100km 떨어진 곳
    await db.insert(places).values({
      contentId: 'far1', contentTypeId: 12, title: '먼바위', regionCode: '26', districtCode: '710', lcls1: 'NA', lcls3: 'NA030300',
      lat: 36.0, lng: 129.5, visible: true, listRaw: {}, introRaw: { restdate: '연중무휴' }, detailSyncedAt: new Date(),
    });
    const suyeong = { regionCode: '26', regionName: '부산광역시', districtCodes: ['500'], label: '부산광역시 수영구' };
    const fan: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [rule('include', '먼바위', '먼바위 가기', 'place')] };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [fan], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    expect(r.candidates.some((c) => c.outside)).toBe(false);
    expect(r.outsideRules).toHaveLength(1);
    expect(r.outsideRules[0].placeId).toBeNull();
    expect(r.outsideRules[0].minutes).toBeGreaterThan(RETRIEVE.outsideMaxMinutes);
  });

  it('여행 날짜가 30일 밖이면 집중률을 부르지 않고 null로 둠', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const crowd = fakeCrowd();
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, matchNames: textNames, matchAreas: textAreas, today: '2026-09-01' });
    expect(crowd.calls).toEqual([]);
    expect(r.crowd.note).toBe('out_of_window');
    expect(r.candidates.every((c) => c.crowd === null)).toBe(true);
  });

  it('구 단위 여행에서 꼭 지킬 것이 여행지에 없고 같은 시·도의 다른 구에만 있으면 1곳을 여행지 밖으로 넣음 (지역 규칙은 기록만)', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const suyeong = { regionCode: '26', regionName: '부산광역시', districtCodes: ['500'], label: '부산광역시 수영구' };
    const fan: MemberInput = {
      ...MEMBERS[1],
      memberId: 'm7',
      mustKeep: [
        rule('include', '태종대온천찜질방', '태종대온천찜질방 가기', 'place'), // 영도구에만 있음 → 넣음
        rule('include', '해수욕장', '바다 보기', 'category', ['NA020900']), // 수영구에 광안리가 있음 → 밖에서 찾지 않음
        rule('include', '해운대', '해운대 가기', 'area'), // 지역 규칙 → 기록만
        rule('include', '없는곳', '없는곳 가기', 'place'), // 어디에도 없음
      ],
    };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [fan], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    const outside = r.candidates.filter((c) => c.outside);
    expect(outside.map((c) => [c.name, c.outside, c.forMembers])).toEqual([['태종대온천찜질방', '영도구', ['m7']]]);
    expect(outside[0].reasons.m7).toContain('꼭 지킬 것: 태종대온천찜질방 가기');
    expect(r.candidates.map((c) => c.name)).not.toContain('송정해수욕장'); // 다른 구 장소는 꼭 지킬 것으로만 들어옴
    expect(r.outsideRules).toEqual([
      { memberId: 'm7', label: '태종대온천찜질방 가기', district: '영도구', placeId: 'p3', minutes: 49 },
      { memberId: 'm7', label: '해운대 가기', district: '해운대구', placeId: null },
    ]);
    expect(outside[0].outsideMinutes).toBe(49); // 여행지 가운데에서 편도 어림 (상한 안)
    // 여행지 밖 장소도 같은 거르기를 거침 (다른 사람의 꼭 피할 것에 걸리면 넣지 않음)
    const spaHater: MemberInput = { ...MEMBERS[0], memberId: 'm6', mustKeep: [rule('avoid', '온천', '온천 빼기', 'category', ['EX050100'])] };
    const blocked = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [fan, spaHater], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    expect(blocked.candidates.some((c) => c.outside)).toBe(false);
    expect(blocked.outsideRules.map((x) => x.placeId)).toEqual([null]);
    // 시·도 전체 여행이면 여행지 밖이 없음
    const whole = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
    expect(whole.outsideRules).toEqual([]);
    expect(whole.candidates.some((c) => c.outside)).toBe(false);
  });

  describe('10/27 검증 뒤 고침 (사용자 결정)', () => {
    const extra = (id: string, type: number, title: string, lcls3: string, o: { district?: string; lat?: number; lng?: number } = {}) => ({
      contentId: id, contentTypeId: type, title, regionCode: '26', districtCode: o.district ?? '500', lcls1: lcls3.slice(0, 2), lcls3,
      lat: o.lat ?? 35.153, lng: o.lng ?? 129.119, visible: true, listRaw: {}, introRaw: { restdate: '연중무휴' }, detailSyncedAt: new Date(),
    });
    const twoDays = { ...CONDITIONS, endDate: '2026-11-08' };
    const mustOf = (r: Awaited<ReturnType<typeof retrieveCandidates>>, id: string, who: string) =>
      [...r.candidates, ...r.lodgings].find((c) => c.id === id)?.marks[who]?.some((k) => k.kind === 'must') ?? false;

    it('장소 이름 규칙: 이름이 같은 곳 중 관광지가 있으면 숙소·가게(이름에 같은 낱말이 든 펜션·매장)는 꼭 지킬 곳이 아님, 식당만 맞으면 그대로', async () => {
      const { db } = await createTestApp();
      await seedDb(db);
      await db.insert(places).values([extra('shop1', 38, '앤더슨벨 광안리해수욕장 스토어', 'SH050200'), extra('pen1', 32, '광안리해수욕장 펜션', 'AC030100')]);
      const fan: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [rule('include', '광안리해수욕장', '광안리 가기', 'place'), rule('include', '이재모피자', '이재모피자 가기', 'place')] };
      const r = await retrieveCandidates(db, { conditions: twoDays, destination: DEST, members: [fan], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
      expect(mustOf(r, 'p1', 'm7')).toBe(true);
      expect(mustOf(r, 'shop1', 'm7')).toBe(false);
      expect(mustOf(r, 'pen1', 'm7')).toBe(false); // 숙소 고르기는 꼭 지킬 숙소를 먼저 고르므로, 이름만 같은 펜션이 숙소로 뽑히지 않게
      expect(r.lodgings.some((c) => c.id === 'pen1')).toBe(true); // 후보에서 빼지는 않음: 다른 숙소와 같은 잣대로 고를 수 있음 (꼭 지킬 표시만 안 붙음)
      expect(mustOf(r, 'p14', 'm7')).toBe(true); // 이재모피자: 식당만 맞으면 그 식당이 꼭 지킬 곳
    });

    it('여행지로 가는 곳이 아닌 시설(사후면세점·도서관·골프장 등 공식 분류)은 후보에서 빼고, 누군가 꼭 지킬 것으로 고른 곳만 넣음', async () => {
      const { db } = await createTestApp();
      await seedDb(db);
      await db.insert(places).values([extra('olive', 38, '체인화장품 광안점', 'SH040300'), extra('lib', 14, '수영구립도서관', 'VE090300'), extra('golf', 28, '바다골프클럽', 'LS010400')]);
      const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
      for (const id of ['olive', 'lib', 'golf']) expect(r.candidates.some((c) => c.id === id)).toBe(false);
      expect(r.excluded.find((e) => e.reason === '여행지로 가는 곳이 아닌 시설')?.count).toBe(3);
      // 꼭 지킬 것으로 고른 종류는 넣음 (예: 도서관 가기)
      const reader: MemberInput = { ...MEMBERS[1], memberId: 'm9', mustKeep: [rule('include', '도서관', '도서관 가기', 'category', ['VE090300'])] };
      const kept = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [reader], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
      expect(mustOf(kept, 'lib', 'm9')).toBe(true);
      expect(kept.candidates.some((c) => c.id === 'golf')).toBe(false);
    });

    it('지역 넣기 규칙은 제외 시설을 끌어들이지 않고, 여행지 전체를 가리키면 조건으로 쓰지 않고 메모만 남김 (10/28 점검)', async () => {
      const { db } = await createTestApp();
      await seedDb(db);
      await db.insert(places).values([extra('olive', 38, '체인화장품 광안점', 'SH040300'), extra('lib', 14, '수영구립도서관', 'VE090300')]);
      const local: MemberInput = { ...MEMBERS[1], memberId: 'm9', mustKeep: [rule('include', '수영', '수영 쪽 위주로', 'area')] };
      const city = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [local], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
      for (const id of ['olive', 'lib']) expect(city.candidates.some((c) => c.id === id)).toBe(false);
      // 수영구 여행 + '수영' 지역 규칙 → 여행지 전체라 모든 후보가 꼭 지킬 곳이 되지 않게 규칙을 쓰지 않음
      const suyeong = { ...DEST, districtCodes: ['500'], label: '부산 수영구' };
      const whole = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [local], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
      expect(whole.candidates.some((c) => c.marks.m9?.some((k) => k.kind === 'must'))).toBe(false);
      expect(whole.missingRules).toContainEqual({ memberId: 'm9', label: '수영 쪽 위주로', reason: '여행지 전체라 조건으로 쓰지 않음' });
    });

    it('여행지 어디에도 맞는 곳이 없는 피하기 규칙은 메모로 알림 (조용히 효과 없이 넘어가지 않게)', async () => {
      const { db } = await createTestApp();
      await seedDb(db);
      const picky: MemberInput = { ...MEMBERS[1], memberId: 'm9', mustKeep: [rule('avoid', '한옥마을 중심가', '사람 많은 한옥마을 중심가 피하기', 'area')] };
      const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [picky], crowdClient: null, matchNames: textNames, matchAreas: textAreas, today: '2026-11-01' });
      expect(r.missingRules).toContainEqual({ memberId: 'm9', label: '사람 많은 한옥마을 중심가 피하기', reason: '여행지 자료에서 맞는 곳을 찾지 못해 적용하지 못함' });
    });

    it('이름 맞추기(LLM)에 보여 주는 후보에서 숙소·가게는 뺌 (식당은 남김)', async () => {
      const { db } = await createTestApp();
      await seedDb(db);
      await db.insert(places).values([
        extra('xsky', 12, '부산엑스더스카이', 'VE010200', { district: '350', lat: 35.16, lng: 129.17 }),
        extra('resi', 32, '엘시티 레지던스', 'AC020200', { district: '350' }),
        extra('gift', 38, '엘시티 기념품점', 'SH050300', { district: '350' }),
      ]);
      const fan: MemberInput = { ...MEMBERS[1], memberId: 'm7', mustKeep: [rule('include', '엘시티 전망대', '엘시티 전망대 가기', 'place')] };
      let shown: string[] = [];
      const matchNames: NameMatcher = async (rules, list) => {
        shown = list.map((p) => p.title);
        return new Map([[rules[0].key, ['xsky']]]);
      };
      const r = await retrieveCandidates(db, { conditions: twoDays, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01', matchNames });
      expect(shown).toContain('부산엑스더스카이');
      expect(shown).toContain('이재모피자');
      expect(shown).not.toContain('엘시티 레지던스');
      expect(shown).not.toContain('엘시티 기념품점');
      expect(mustOf(r, 'xsky', 'm7')).toBe(true);
    });
  });
});

describe('회의 조건 API와 시험 경로', () => {
  async function demoTrip() {
    const t = await createTestApp({ devUi: true });
    await seedDb(t.db);
    const demo = await call(t.app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
    return { ...t, tripId: demo.body.trip.id as string, token: demo.body.token as string };
  }

  it('방장만 조건을 저장하고, 목적지를 코드로 바꿔 여행 상세에 보여 줌', async () => {
    const { app, tripId, token } = await demoTrip();
    const body = { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08' };
    const saved = await call(app, 'PUT', `/trips/${tripId}/conditions`, body, token);
    expect(saved.status).toBe(200);
    expect(saved.body.destination).toMatchObject({ regionCode: '26', label: '부산광역시' });
    expect(saved.body.conditions.rules).toEqual({ aiMinSatisfaction: 7, maxRounds: 5 });
    const detail = await call(app, 'GET', `/trips/${tripId}`, undefined, token);
    expect(detail.body.conditions).toMatchObject({ destination: '부산', startDate: '2099-11-07' });

    const bad = await call(app, 'PUT', `/trips/${tripId}/conditions`, { ...body, destination: '중구' }, token);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await call(app, 'PUT', `/trips/${tripId}/conditions`, { ...body, endDate: '2099-11-12' }, token)).status).toBe(400);
    expect((await call(app, 'PUT', `/trips/${tripId}/conditions`, { ...body, startDate: '2020-01-01', endDate: '2020-01-01' }, token)).status).toBe(400);

    const join = await call(app, 'POST', `/invites/${(await call(app, 'GET', `/trips/${tripId}`, undefined, token)).body.trip.inviteCode}/join`, { nickname: '손님' });
    expect(join.status).toBe(409); // 시연 여행은 이미 4명
  });

  it('시험 경로는 터널(외부) 요청을 막고, 이 PC에서는 1–2단계를 실행함', async () => {
    const { app, tripId, token } = await demoTrip();
    const tunnel = await call(app, 'POST', '/dev/meeting/retrieve', {}, token, { 'cf-connecting-ip': '203.0.113.7' });
    expect(tunnel.status).toBe(403);
    // Cloudflare가 아닌 터널(프록시 헤더만 있음)도 외부 요청으로 막음
    expect((await call(app, 'POST', '/dev/meeting/retrieve', {}, token, { 'x-forwarded-for': '203.0.113.8' })).status).toBe(403);
    // 방장 성향이 없으면 409 PERSONA_REQUIRED
    await call(app, 'PUT', `/trips/${tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, token);
    expect((await call(app, 'POST', '/dev/meeting/retrieve', {}, token)).body.error.code).toBe('PERSONA_REQUIRED');
    await call(app, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_night', 'like_sea'], []) }, token);
    const res = await call(app, 'POST', '/dev/meeting/retrieve', {}, token);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(4);
    expect(res.body.retrieve.candidates.length).toBeGreaterThan(0);
    expect(res.body.retrieve.crowd.note).toBe('out_of_window'); // 2099년이라 예측 없음, 호출기도 없음
    expect(res.body.trace.map((t: { node: string }) => t.node)).toEqual(['prepare', 'retrieve']);

    // 그래프 칸: 실제 그래프 구조 (실행·외부 호출 없음), 터널 요청은 막음
    const graph = await call(app, 'GET', '/dev/meeting/graph');
    expect(graph.body.nodes.map((n: { id: string }) => n.id)).toEqual(['__start__', 'prepare', 'retrieve', 'pick', 'gather', 'react', 'review', 'schedule', 'evaluate', 'tally', 'revise', 'moderate', '__end__']);
    // 8–10단계 고리: 평가 → 집계 → (끝 또는 수정) → 사회자 → 평가
    expect(graph.body.edges).toContainEqual({ from: 'evaluate', to: 'tally', conditional: false });
    expect(graph.body.edges).toContainEqual({ from: 'tally', to: 'revise', conditional: true });
    expect(graph.body.edges).toContainEqual({ from: 'tally', to: '__end__', conditional: true });
    expect(graph.body.edges).toContainEqual({ from: 'revise', to: 'moderate', conditional: true });
    expect(graph.body.edges).toContainEqual({ from: 'moderate', to: 'evaluate', conditional: false });
    expect(graph.body.edges).toContainEqual({ from: 'react', to: 'review', conditional: true }); // 고를 안건이 있을 때만 사람 확인
    expect(graph.body.edges).toContainEqual({ from: 'react', to: 'schedule', conditional: true }); // 없으면 바로 6단계
    expect(graph.body.edges).toContainEqual({ from: 'review', to: 'schedule', conditional: false });
    expect(graph.body.nodes.find((n: { id: string }) => n.id === 'schedule')).toMatchObject({ step: 6, kind: 'code' });
    expect(graph.body.nodes.find((n: { id: string }) => n.id === 'review')).toMatchObject({ step: 5, kind: 'human' });
    expect(graph.body.edges).toContainEqual({ from: 'prepare', to: 'retrieve', conditional: false });
    expect(graph.body.edges).toContainEqual({ from: 'gather', to: 'react', conditional: false });
    expect((await call(app, 'GET', '/dev/meeting/graph', undefined, undefined, { 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403);
  });

  it('DEV_UI_TUNNEL을 켜도 접근 키가 없는 서버는 터널 요청에 시험 경로를 열지 않음 (키를 빠뜨려 바깥에 열리지 않게)', async () => {
    const { app } = await createTestApp({ devUi: true, devUiTunnel: true });
    const tunnel = { 'cf-connecting-ip': '203.0.113.7' };
    expect((await call(app, 'GET', '/dev/meeting/graph', undefined, undefined, tunnel)).status).toBe(403);
    // 빈 헤더도 서버 안 요청으로 보지 않음
    expect((await call(app, 'GET', '/dev/meeting/graph', undefined, undefined, { 'cf-connecting-ip': '' })).status).toBe(403);
    expect((await call(app, 'GET', '/dev/meeting/graph')).status).toBe(200);
  });
});

describe('3단계 고르기 ×4 (시험 경로 /dev/meeting/run)', () => {
  /** 가짜 LLM: 후보 표의 앞쪽 id를 고름. bad(member 제목, 몇 번째 호출)가 true면 표에 없는 id를 냄 */
  const pickLlm = (bad: (title: string, n: number) => boolean = () => false, ignoreMust: (title: string, n: number) => boolean = () => false) => {
    const seen = new Map<string, number>();
    return fakeLlm((input) => {
      // 2단계 이름 맞추기 요청 1번 (지은의 흰여울문화마을·현우의 돼지국밥): 목록에서 이름·메뉴에 그 말이 든 곳을 고름 (흰여울문화마을은 시험 자료에 없음)
      if (input.areas !== undefined) return areaAnswer(input);
      if (input.rules) return nameAnswer(input);
      if (input.plans) return evalAnswer(input); // 7단계 평가: 모두 찬성
      if (input.places) return { checks: [] }; // 4단계 AI 반응: 반응 없음
      const title: string = input.me.title;
      const n = (seen.get(title) ?? 0) + 1;
      seen.set(title, n);
      // 잘 따르는 LLM처럼 꼭 지킬 것 번호를 먼저 고름 (ignoreMust면 무시)
      const table = (input.candidates as string).split('\n').slice(1).map((l) => l.split('|')[0]);
      const ids = ignoreMust(title, n) ? table.filter((id) => !input.me.mustKeepIds.includes(id)) : [...new Set([...input.me.mustKeepIds, ...table])];
      const picks = bad(title, n) ? ['없는1', '없는2', '없는3'] : ids.slice(0, PICK.count);
      const lodging = (input.lodgings as string) ? (input.lodgings as string).split('\n')[1].split('|')[0] : '';
      return { picks: picks.map((id) => ({ id, reason: '내 취향에 맞아요' })), lodging: { id: lodging, reason: lodging ? '편해 보여요' : '' }, comment: '여기 좋아요!' };
    });
  };
  async function readyTrip(options: Parameters<typeof createTestApp>[0] = {}) {
    const t = await createTestApp({ devUi: true, ...options });
    await seedDb(t.db);
    const demo = await call(t.app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
    const token = demo.body.token as string;
    // 방장 성향은 터널 요청으로 만들어 규칙 카드 (가짜 LLM은 고르기에만 쓰임)
    await call(t.app, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_night', 'like_sea'], []) }, token, { 'cf-connecting-ip': '203.0.113.7' });
    await call(t.app, 'PUT', `/trips/${demo.body.trip.id}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08' }, token);
    return { ...t, token, tripId: demo.body.trip.id as string };
  }
  const run = async (app: Awaited<ReturnType<typeof createTestApp>>['app'], token: string, headers: Record<string, string> = {}) => {
    const res = await app.request('/api/v1/dev/meeting/run', { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers } });
    const text = await res.text();
    return { status: res.status, lines: res.status === 200 ? text.trim().split('\n').map((l) => JSON.parse(l)) : [JSON.parse(text)] };
  };

  it('실행 결과(멈춤·끝과 상태)는 실행 흐름에서 받음: 끝난 뒤 읽은 체크포인트가 이전 단계여도(시계가 뒤로 감) 결과가 바뀌지 않음 (10/28 점검)', async () => {
    const llm = pickLlm();
    const t = await readyTrip({ llm });
    const limits = { runsPerTrip: 9, llmCallsPerRun: 30, llmDailyLimit: 500 };
    const real = buildMeetingGraph({ db: t.db, crowdClient: null, llm, limits, checkpointer: new MemorySaver() });
    // 체크포인트 id가 시각 기반이라 시계가 뒤로 가면 getState가 이전 단계를 돌려줄 수 있음: 그 경우를 흉내 냄
    const stale = { stream: real.stream.bind(real), getState: async () => ({ values: {}, tasks: [] }) } as unknown as typeof real;
    const service = meetingService({ db: t.db, graph: stale, limits });
    const out = await (await service.start(t.tripId)).done;
    expect(['reviewing', 'done']).toContain(out.status);
    expect(out.state?.members.length).toBe(4);
    expect(out.state?.board?.candidates.length).toBeGreaterThan(0);
  });

  it('4명이 각자 3곳 + 숙소를 고르고, 명세서 이벤트를 순서대로 기록·전송함 (LLM 4회)', async () => {
    const llm = pickLlm();
    const { app, db, token } = await readyTrip({ llm });
    const { status, lines } = await run(app, token);
    expect(status).toBe(200);
    const result = lines.find((l) => l.kind === 'result');
    expect(result.llmCalls).toBe(4 + 1 + 4); // 고르기 4 + 이름 맞추기 1 (흰여울문화마을·돼지국밥을 한 번에) + 7단계 평가 4
    expect(llm.calls).toBe(4 + 1 + 4);
    expect(evalCalls(result)).toBe(4);
    expect(result.picks).toHaveLength(4);
    const ids = new Set(result.retrieve.candidates.map((c: { id: string }) => c.id));
    for (const p of result.picks) {
      expect(p).toMatchObject({ source: 'llm', comment: '여기 좋아요!' });
      expect(p.picks).toHaveLength(PICK.count);
      expect(p.picks.every((x: { id: string }) => ids.has(x.id))).toBe(true);
      expect(p.lodging).not.toBeNull(); // 1박이라 숙소도 고름
    }
    expect(result.board.candidates.every((c: { placeId: string; proposedBy: string[] }) => c.placeId.startsWith('plc_') && c.proposedBy.length > 0)).toBe(true);

    const events = lines.filter((l) => l.kind === 'event').map((l) => l.event);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0]).toMatchObject({ type: 'meeting.started', data: { kind: 'meeting' } });
    expect(events[0].data.agents).toHaveLength(4);
    // 고를 안건(장소 안건)이 없는 보드라 5단계에서 멈추지 않고 6단계 A·B 두 안을 보낸 뒤 7단계 평가 1라운드 (사람마다 한마디 1개·안마다 투표 1개)
    const proposed = events.findIndex((e) => e.type === 'plan.proposed');
    expect(events.slice(proposed, proposed + 2).map((e) => [e.type, e.data.label])).toEqual([['plan.proposed', 'A'], ['plan.proposed', 'B']]);
    const round = events.slice(proposed + 2);
    expect(round[0]).toMatchObject({ type: 'round.started', data: { round: 1, maxRounds: 5 } });
    expect(round.slice(1).map((e) => e.type)).toEqual(Array(4).fill(['agent.message', 'vote.cast', 'vote.cast']).flat());
    expect(round.find((e) => e.type === 'vote.cast').data).toMatchObject({ round: 1, vote: 'yes', stance: '찬성' });
    expect(events.filter((e) => e.type === 'board.updated').at(-1).data.agenda.some((a: { placeId: string | null }) => a.placeId !== null)).toBe(false);
    expect(events.some((e) => e.type.startsWith('review.'))).toBe(false);
    // 4단계: 3단계 끝의 보드(반응 없음) 다음에 반응·안건을 채운 보드를 한 번 더 보냄 (코드, LLM 횟수 그대로)
    const boards = events.filter((e) => e.type === 'board.updated');
    expect(boards).toHaveLength(2);
    expect(boards[0].data.candidates.every((c: { reactions: unknown[] }) => c.reactions.length === 0)).toBe(true);
    const agentIds = new Set(events[0].data.agents.map((a: { agentId: string }) => a.agentId));
    for (const c of boards[1].data.candidates) for (const r of c.reactions) {
      expect(agentIds.has(r.agentId)).toBe(true);
      expect(['like', 'warn', 'block']).toContain(r.kind);
      expect(r.reason.length).toBeGreaterThan(0);
    }
    expect(Array.isArray(boards[1].data.agenda)).toBe(true);
    expect(result.board).toEqual(boards[1].data);
    expect(result.scores).toHaveLength(result.board.candidates.length);
    // 6단계: A·B 두 안을 이벤트와 결과에 같이 보냄. 길찾기 호출기가 없어 카카오 0회이고 구간은 시간 없이 직선거리만 (LLM 횟수 그대로)
    expect(result.plans.map((p: { label: string }) => p.label)).toEqual(['A', 'B']);
    expect(events.filter((e) => e.type === 'plan.proposed').map((e) => e.data)).toEqual(result.plans);
    expect(result.plans[0].route.map((d: { date: string }) => d.date)).toEqual(['2099-11-07', '2099-11-08']);
    expect(result.kakao.calls).toEqual({ transit: 0, walk: 0, car: 0 });
    const legs = result.plans.flatMap((p: { route: { stops: { moveFromPrev: { source: string; minutes: number | null } | null }[] }[] }) =>
      p.route.flatMap((d) => d.stops.flatMap((s) => (s.moveFromPrev ? [s.moveFromPrev] : []))),
    );
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l: { source: string; minutes: number | null }) => l.source === 'estimate' && l.minutes === null)).toBe(true);
    const stages = events.filter((e) => e.type === 'research.progress').map((e) => e.data.stage);
    for (const stage of ['planning', 'done']) expect(stages.filter((x) => x === stage)).toHaveLength(4);
    expect(stages.filter((x) => x === 'searching').length).toBeGreaterThanOrEqual(8); // 사람마다 장소 찾기·인기 순위(+혼잡도)
    expect(stages.filter((x) => x === 'picking').length).toBe(4 + 4 * (PICK.count + 1)); // 고르기 시작 + 고른 곳·숙소마다
    expect(events.filter((e) => e.type === 'agent.message').map((e) => e.data.round)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]); // 3단계 고르기 한마디 4 + 7단계 평가 한마디 4
    const done = events.find((e) => e.type === 'research.progress' && e.data.stage === 'done');
    expect(done.data.focus).toMatchObject({ label: expect.any(String) });

    // 시험 화면용 LLM 과정(요청·받는 글자·응답)은 화면으로만 보내고 DB에는 기록하지 않음
    // 2단계 이름 맞추기 1회는 agentId 없이 purpose 'names'로 보냄 (고르기 4회와 구분)
    const names = lines.filter((l) => l.kind === 'llm' && l.data.purpose === 'names');
    expect(names.map((l) => l.type)).toEqual(['llm.request', 'llm.response']);
    expect(names[0].data.input.rules).toEqual(['1|장소|흰여울문화마을', '2|음식|돼지국밥']); // 장소·음식 이름 규칙은 모두 AI가 맞춤 (10/29 '가')
    // 7단계 평가 4회는 purpose 'eval': 입력은 일정안 표(번호|장소|분류|오는 길|내 조건)와 코드가 계산한 사실
    const evals = lines.filter((l) => l.kind === 'llm' && l.data.purpose === 'eval' && l.type === 'llm.request');
    expect(evals).toHaveLength(4);
    expect(evals[0].data.input.plans.A.split('\n')[0]).toBe('번호|장소|분류|오는 길|내 조건');
    expect(Object.keys(evals[0].data.input.facts.A)).toEqual(['기준', '꼭지킬것', '이동많은날']);
    const traces = lines.filter((l) => l.kind === 'llm' && l.data.purpose !== 'names' && l.data.purpose !== 'eval');
    expect(traces.filter((l) => l.type === 'llm.request')).toHaveLength(4);
    expect(traces.filter((l) => l.type === 'llm.response')).toHaveLength(4);
    const first = traces.find((l) => l.type === 'llm.request').data.agentId;
    const typed = traces.filter((l) => l.type === 'llm.delta' && l.data.agentId === first).map((l) => l.data.text).join('');
    expect(JSON.parse(typed).picks).toHaveLength(PICK.count);
    const input = traces.find((l) => l.type === 'llm.request').data.input;
    expect(input.candidates.split('\n')[0]).toBe('번호|이름|분류|인기|혼잡|영업|내 조건|소개'); // id 대신 짧은 번호, 숫자의 뜻·내 조건은 코드가 적음
    expect(input.me.limits[0]).toMatch(/^하루 일정 \d{2}:\d{2}~\d{2}:\d{2}$/);
    expect(['이름난 곳', '덜 알려진 곳', '상관없음']).toContain(input.me.prefers.popular);

    // 다시 접속한 화면은 afterSeq 뒤부터 받음
    const again = await call(app, 'GET', '/dev/meeting/events?afterSeq=2', undefined, token);
    expect(again.body.events[0].seq).toBe(3);
    expect(again.body.events).toHaveLength(events.length - 2);
    expect(again.body.events.some((e: { type: string }) => e.type.startsWith('llm.'))).toBe(false);
    const [row] = await db.select().from(meetings);
    expect(row).toMatchObject({ status: 'done', llmCalls: 4 + 1 + 4, runNo: 1 });
  });

  it('4단계 AI 반응: 사람마다 LLM 1회로 다른 AI가 고른 곳에 반응하고, 근거가 있는 ⚠는 안건이 되어 5단계에서 멈춤 (근거를 지어낸 반응은 버림)', async () => {
    const llm = fakeLlm((input) => {
      if (input.areas !== undefined) return areaAnswer(input);
      if (input.rules) return nameAnswer(input);
      if (input.plans) return evalAnswer(input); // 7단계 평가: 모두 찬성
      if (input.places) {
        // 서연(싫어요: 오래 걷기)만 반응함
        if (!input.me.wishes.includes('오래 걷기 싫어함')) return { checks: [] };
        const [code, name] = (input.places as string).split('\n')[1].split('|');
        return {
          checks: [
            { place: code, evidence: name, wish: '오래 걷기 싫어함', relation: '충돌', reason: '많이 걸을 것 같아요' },
            { place: code, evidence: '지어낸 근거', wish: '오래 걷기 싫어함', relation: '충돌', reason: '못 가요' },
            { place: code, evidence: name, wish: '지어낸 바람', relation: '충돌', reason: '못 가요' },
          ],
        };
      }
      // AI마다 표의 다른 곳부터 골라 서로 다른 곳이 보드에 오르게 함
      const table = (input.candidates as string).split('\n').slice(1).map((l) => l.split('|')[0]);
      const shift = Math.max(0, ['반짝반짝 탐험가', '꼼꼼한 맛집 플래너', '느긋한 힐러'].indexOf(input.me.title) + 1) * PICK.count;
      const ids = [...new Set([...input.me.mustKeepIds, ...table.slice(shift), ...table])].slice(0, PICK.count);
      const lodging = (input.lodgings as string) ? (input.lodgings as string).split('\n')[1].split('|')[0] : '';
      return { picks: ids.map((id) => ({ id, reason: '좋아요' })), lodging: { id: lodging, reason: lodging ? '편해요' : '' }, comment: '가요!' };
    });
    const { app, token } = await readyTrip({ llm });
    const { lines } = await run(app, token);
    const result = lines.find((l) => l.kind === 'result');
    const seoyeon = result.members.find((m: { title: string }) => m.title === '느긋한 힐러');
    const agent = `agt_${seoyeon.memberId.replace(/^mem_/, '')}`;
    const hit = result.board.candidates.find((c: { reactions: { agentId: string; reason: string }[] }) => c.reactions.some((r) => r.agentId === agent && r.reason.includes('많이 걸을 것 같아요')));
    expect(hit.reactions.find((r: { agentId: string }) => r.agentId === agent).reason).toContain(`많이 걸을 것 같아요 ('${hit.name}')`);
    expect(JSON.stringify(result.board)).not.toContain('못 가요');
    expect(result.status).toBe('reviewing');
    expect(result.review.items.map((i: { placeId: string }) => i.placeId)).toContain(hit.placeId);
    const calls = reactCalls(result);
    expect(calls).toBeGreaterThan(0);
    expect(result.llmCalls).toBe(4 + 1 + calls); // 고르기 4 + 이름 맞추기 1 + AI 반응
    expect(lines.filter((l) => l.kind === 'llm' && l.type === 'llm.request' && l.data.purpose === 'react')).toHaveLength(calls);
  });

  it('자기 조건에 걸린 곳을 고르면 그 AI만 1번 더 부르고, 그래도 고르면 코드가 걸리지 않는 곳으로 바꿈', async () => {
    // 나쁜 AI: 내 조건에 ⚠·✕가 붙은 곳을 먼저 고름
    const llm = fakeLlm((input) => {
      if (input.plans) return evalAnswer(input); // 7단계 평가: 모두 찬성
      if (input.places) return { checks: [] }; // 4단계 AI 반응: 반응 없음
      const rows = (input.candidates as string).split('\n').slice(1).map((l) => l.split('|'));
      const bad = rows.filter((r) => /^[⚠✕]/.test(r[6])).map((r) => r[0]);
      const ids = [...new Set([...input.me.mustKeepIds, ...bad, ...rows.map((r) => r[0])])].slice(0, PICK.count);
      const lodging = (input.lodgings as string) ? (input.lodgings as string).split('\n')[1].split('|')[0] : '';
      return { picks: ids.map((id) => ({ id, reason: '좋아요' })), lodging: { id: lodging, reason: lodging ? '편해요' : '' }, comment: '가요!' };
    });
    const { app, token } = await readyTrip({ llm });
    const result = (await run(app, token)).lines.find((l) => l.kind === 'result');
    expect(result.picks.filter((p: { llmCalls: number }) => p.llmCalls === 2).length).toBeGreaterThan(0); // 걸린 곳을 고른 AI만 1번 더 (서연: 오래 걷기 싫어요 ↔ 장산)
    expect(result.llmCalls).toBe(1 + 4 + result.picks.filter((p: { llmCalls: number }) => p.llmCalls === 2).length + reactCalls(result) + evalCalls(result));
    // 최종 보드에는 고른 사람 자신의 ⚠·✕가 없음
    const self = result.board.candidates.flatMap((c: { proposedBy: string[]; reactions: { agentId: string; kind: string }[] }) => c.reactions.filter((r) => c.proposedBy.includes(r.agentId) && r.kind !== 'like'));
    expect(self).toEqual([]);
  });

  it('형식이 틀리면 1번 더 부르고, 그래도 틀리면 그 사람만 규칙 고르기 (몫 점수 상위)', async () => {
    // 첫째(방장)는 첫 호출만 틀리고, 둘째(지은)는 계속 틀림
    const llm = pickLlm((title, n) => (title === '반짝반짝 탐험가' ? true : n === 1 && title !== '꼼꼼한 맛집 플래너' && title !== '느긋한 힐러'));
    const { app, token } = await readyTrip({ llm });
    const { lines } = await run(app, token);
    const result = lines.find((l) => l.kind === 'result');
    const byTitle = Object.fromEntries(result.members.map((m: { memberId: string; title: string }) => [m.title, result.picks.find((p: { memberId: string }) => p.memberId === m.memberId)]));
    expect(byTitle['반짝반짝 탐험가']).toMatchObject({ source: 'rule', llmCalls: PICK.tries });
    const host = result.picks.find((p: { source: string; llmCalls: number }) => p.llmCalls === 2 && p.source === 'llm');
    expect(host).toBeDefined();
    expect(result.llmCalls).toBe(1 + PICK.tries + 2 + 1 + 1 + reactCalls(result) + evalCalls(result)); // 이름 맞추기 1 + 고르기 + 4단계 AI 반응 + 7단계 평가
    const rulePick = byTitle['반짝반짝 탐험가'];
    const mine = result.retrieve.candidates.filter((c: { forMembers: string[] }) => c.forMembers.includes(rulePick.memberId));
    expect(rulePick.picks.every((x: { id: string }) => mine.some((c: { id: string }) => c.id === x.id))).toBe(true);
  });

  /** 8–10단계 시험용 평가 답: 1라운드에 '반짝반짝 탐험가'만 A안에 반대하며 A안의 태그 없는 첫 관광지를 빼 달라고 함, 그 밖은 모두 찬성·요청 없음 */
  const roundLlm = () => {
    const base = pickLlm();
    return fakeLlm(async (input, n, system, schema) => {
      if (!input.plans) return base.generateJson({ system, input, schema, schemaName: 'test' });
      const ans = evalAnswer(input);
      if (input.me.title !== '반짝반짝 탐험가' || input.round !== 1) return ans;
      const row = (input.plans.A as string).split('\n').find((l) => /^A\d+\|[^|(]+\|/.test(l))!;
      return { ...ans, a: { why: '여기는 별로예요', stance: '반대' }, requests: [{ plan: 'A', type: 'avoid', place: row.split('|')[0], to: '-', reason: '별로예요' }] };
    });
  };
  const strictRules = (t: Awaited<ReturnType<typeof readyTrip>>, rules: { aiMinSatisfaction: number; maxRounds: number }) =>
    call(t.app, 'PUT', `/trips/${t.tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08', rules }, t.token);
  const roundCalls = (r: { members: { llmCalls: number }[] }) => r.members.reduce((a, m) => a + m.llmCalls, 0);

  it('8–10단계: 통과 못 한 안은 요청대로 고쳐 다시 짜고(plan.proposed version 2), 사회자가 고른 AI만 2라운드에 말함 (나머지는 지난 평가를 그대로 두고 만족도만 다시 계산)', async () => {
    const llm = roundLlm();
    const t = await readyTrip({ llm });
    expect((await strictRules(t, { aiMinSatisfaction: 10, maxRounds: 5 })).status).toBe(200); // 기준 10점: 모두 찬성이어도 거의 통과 못 함
    const { lines } = await run(t.app, t.token);
    const result = lines.find((l) => l.kind === 'result');
    expect(result.status).toBe('done');
    expect(result.rounds).toHaveLength(2);
    const [r1, r2] = result.rounds;
    expect(r1.tally.some((x: { passed: boolean }) => !x.passed)).toBe(true);
    const unhappy = result.members.find((m: { title: string }) => m.title === '반짝반짝 탐험가').memberId;
    const asked = r1.members.find((m: { memberId: string }) => m.memberId === unhappy).requests[0];
    expect(r1.applied.filter((a: { applied: boolean }) => a.applied)).toEqual([expect.objectContaining({ by: unhappy, plan: 'A', type: 'avoid', note: expect.stringMatching(/^A안 \d일째 .+ 뺌/) })]);
    expect(r1.next).toBe('revise');
    expect(r2.speakers).toContain(unhappy);
    expect(result.outcome).toBe('no_change'); // 2라운드는 모두 찬성·요청 없음 → 반영할 것이 없어 그때의 A·B를 넘김

    const events = lines.filter((l) => l.kind === 'event').map((l) => l.event);
    const proposed = events.filter((e) => e.type === 'plan.proposed');
    expect(proposed.map((e) => [e.data.label, e.data.version])).toEqual([
      ['A', 1],
      ['B', 1],
      ['A', 2],
    ]);
    expect(proposed[2].data.planId).toBe(proposed[0].data.planId);
    expect(proposed[2].data.changes).toEqual([r1.applied.find((a: { applied: boolean }) => a.applied).note.replace(/^A안 /, '')]);
    expect(proposed[2].data.route.flatMap((d: { stops: { placeId: string }[] }) => d.stops.map((x) => x.placeId))).not.toContain(asked.placeId);
    // 2라운드: round.started(말할 AI) 뒤 말한 AI만 한마디, 투표는 모두 (그대로 둔 AI는 carried)
    const at = events.findIndex((e) => e.type === 'round.started' && e.data.round === 2);
    expect(at).toBeGreaterThan(events.indexOf(proposed[2]));
    const speakers = new Set<string>(events[at].data.speakers);
    const round2 = events.slice(at + 1);
    expect(round2.filter((e) => e.type === 'agent.message').map((e) => e.data.agentId).sort()).toEqual([...speakers].sort());
    const votes = round2.filter((e) => e.type === 'vote.cast');
    expect(votes).toHaveLength(8);
    for (const v of votes) expect(v.data).toMatchObject({ round: 2, carried: !speakers.has(v.data.agentId) });
    expect(events.filter((e) => e.type === 'vote.cast' && e.data.round === 1).every((e) => e.data.carried === false)).toBe(true);
    // AI 횟수: 2라운드는 말한 사람만 1번씩
    expect(roundCalls(r2)).toBe(speakers.size);
    expect(result.llmCalls).toBe(llm.calls);
    for (const m of r2.members.filter((x: { memberId: string }) => !speakers.has(`agt_${x.memberId.replace(/^mem_/, '')}`))) expect(m).toMatchObject({ carried: true, llmCalls: 0 });
  });

  it('AI 상한: 2라운드에 회의 AI 상한이 남지 않으면 말할 사람은 규칙 평가로 대신하고 상한(limit)으로 표시함', async () => {
    const llm = roundLlm();
    const t = await readyTrip({ llm });
    await strictRules(t, { aiMinSatisfaction: 10, maxRounds: 5 });
    const first = (await run(t.app, t.token)).lines.find((l) => l.kind === 'result');
    const round1 = first.llmCalls - roundCalls(first.rounds[1]);
    const capped = createApp({ db: t.db, rateLimitPerMinute: 1000, devUi: true, llm, meetingLlmCallsPerRun: round1 });
    const again = (await run(capped, t.token)).lines.find((l) => l.kind === 'result');
    expect(again.llmCalls).toBe(round1);
    const r2 = again.rounds[1];
    for (const id of r2.speakers) expect(r2.members.find((m: { memberId: string }) => m.memberId === id)).toMatchObject({ source: 'rule', llmCalls: 0, fixes: [{ kind: 'limit', plan: null }] });
  });

  it('최대 라운드가 1이면 1라운드 집계에서 통과 못 해도 끝냄 (max_rounds, 그때의 A·B를 넘김)', async () => {
    const llm = roundLlm();
    const t = await readyTrip({ llm });
    await strictRules(t, { aiMinSatisfaction: 10, maxRounds: 1 });
    const { lines } = await run(t.app, t.token);
    const result = lines.find((l) => l.kind === 'result');
    expect(result.rounds).toHaveLength(1);
    expect(result.outcome).toBe('max_rounds');
    expect(lines.filter((l) => l.kind === 'event').filter((e) => e.event.type === 'plan.proposed')).toHaveLength(2);
    expect(lines.filter((l) => l.kind === 'node').map((l) => l.node).slice(-2)).toEqual(['evaluate', 'tally']);
  });

  it('8–12단계 시뮬레이션: 무작위 AI 평가 답(입장·요청·형식 오류·긴 글)과 기준·최대 라운드로 회의 전체를 돌려도 라운드·이벤트·version·AI 횟수·끝난 까닭·꼭 지킬 것이 규칙대로', { timeout: 600_000 }, async () => {
    const N = Number(process.env.SIM_MEETINGS ?? 6);
    const problems: string[] = [];
    const outcomes: Record<string, number> = {};
    for (let k = 0; k < N; k++) {
      let seed = 7000 + k;
      const rnd = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      const base = pickLlm();
      const llm = fakeLlm(async (input, n, system, schema) => {
        if (!input.plans) return base.generateJson({ system, input, schema, schemaName: 'test' });
        if (rnd() < 0.05) return { ...evalAnswer(input), a: { why: '좋아요', stance: '약간 찬성' } }; // 형식 오류 → 1번 더
        const labels = Object.keys(input.plans);
        const codesOf = (l: string) => (input.plans[l] as string).split('\n').map((x) => x.split('|')[0]).filter((c) => /^[AB]\d+$/.test(c));
        const cands = (input.candidates as string).split('\n').slice(1).map((x) => x.split('|')[0]);
        const view = () => ({ why: rnd() < 0.1 ? '아주 긴 이유'.repeat(12) : '이유는 이래요', stance: pick(['찬성', '조건부', '반대']) });
        const requests = Array.from({ length: Math.floor(rnd() * 3) }, () => {
          const plan = pick(labels);
          const type = pick(['include', 'avoid', 'replace', 'move']);
          const own = codesOf(plan);
          const other = codesOf(labels.find((l) => l !== plan) ?? plan);
          const place = type === 'include' ? (cands.length ? pick(cands) : '-') : type === 'move' && rnd() < 0.4 ? '-' : rnd() < 0.1 ? pick(other) : pick(own);
          return { plan, type, place, to: type === 'replace' && cands.length ? pick(cands) : '-', reason: rnd() < 0.1 ? 'plans 칸의 A3' : '바꿔 주세요' };
        });
        return { ...Object.fromEntries(labels.map((l) => [l.toLowerCase(), view()])), comment: rnd() < 0.1 ? '말이 너무 길어요'.repeat(10) : '좋아요!', requests };
      });
      const t = await readyTrip({ llm });
      const rules = { aiMinSatisfaction: 5 + Math.floor(rnd() * 6), maxRounds: 1 + Math.floor(rnd() * 5) };
      await call(t.app, 'PUT', `/trips/${t.tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08', rules }, t.token);
      const { status, lines } = await run(t.app, t.token);
      const tag = `회의 ${k} (기준 ${rules.aiMinSatisfaction} · 최대 ${rules.maxRounds})`;
      const result = lines.find((l) => l.kind === 'result');
      if (status !== 200 || !result || result.status !== 'done') {
        problems.push(`${tag}: 끝나지 않음 ${JSON.stringify(lines.find((l) => l.kind === 'error') ?? result?.status)}`);
        continue;
      }
      const rounds = result.rounds as { round: number; speakers: string[]; members: { memberId: string; carried?: boolean; source: string; llmCalls: number; plans: { plan: string; stance: string; score: number }[]; facts: { plan: string; musts: { rule: number; kept: boolean }[] }[] }[]; tally: { plan: string; average: number; passed: boolean }[]; next: string | null; outcome: string | null; applied: { plan: string; type: string; applied: boolean; placeId: string | null; toId: string | null }[]; hurt: string[]; reverted: string[]; restored?: string[] }[];
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      const last = rounds.at(-1)!;
      if (rounds.length < 1 || rounds.length > rules.maxRounds) problems.push(`${tag}: 라운드 ${rounds.length}개`);
      if (result.outcome === 'passed' && !last.tally.every((x) => x.passed)) problems.push(`${tag}: passed인데 통과 못 한 안`);
      if (['max_rounds', 'stalled', 'no_change'].includes(result.outcome) && last.tally.every((x) => x.passed)) problems.push(`${tag}: ${result.outcome}인데 둘 다 통과`);
      if (result.outcome === 'max_rounds' && rounds.length !== rules.maxRounds) problems.push(`${tag}: max_rounds인데 라운드 ${rounds.length}`);
      if (!['passed', 'max_rounds', 'stalled', 'no_change'].includes(result.outcome)) problems.push(`${tag}: 끝난 까닭 ${result.outcome}`);
      // 이벤트: 라운드마다 round.started(말할 AI) · 말한 AI만 한마디 · 모두 투표 (되돌린 안은 투표를 다시 보냄)
      const events = lines.filter((l) => l.kind === 'event').map((l) => l.event);
      const starts = events.filter((e) => e.type === 'round.started');
      if (starts.length !== rounds.length) problems.push(`${tag}: round.started ${starts.length} ≠ 라운드 ${rounds.length}`);
      rounds.forEach((rd, i) => {
        const agt = (id: string) => `agt_${id.replace(/^mem_/, '')}`;
        if (JSON.stringify(starts[i]?.data.speakers) !== JSON.stringify(rd.speakers.map(agt))) problems.push(`${tag} 라운드 ${rd.round}: speakers가 기록과 다름`);
        const said = events.filter((e) => e.type === 'agent.message' && e.data.round === rd.round).length;
        if (said !== rd.members.filter((m) => !m.carried).length) problems.push(`${tag} 라운드 ${rd.round}: 한마디 ${said}개`);
        const votes = events.filter((e) => e.type === 'vote.cast' && e.data.round === rd.round).length;
        if (votes !== rd.members.length * (2 + (rd.restored ?? []).length)) problems.push(`${tag} 라운드 ${rd.round}: 투표 ${votes}개`);
        for (const m of rd.members) if (m.carried && m.llmCalls !== 0) problems.push(`${tag} 라운드 ${rd.round}: 그대로 둔 AI가 LLM ${m.llmCalls}회`);
        for (const l of ['A', 'B']) {
          const n = rd.applied.filter((a) => a.plan === l && a.applied).length;
          if (n > 3) problems.push(`${tag} 라운드 ${rd.round} ${l}: ${n}개 반영`);
        }
        // 사회자: 통과 못 한 안에 조건부·반대를 낸 AI는 다음 라운드에 반드시 말함 (다듬기 라운드 제외)
        const next = rounds[i + 1];
        if (next && rd.next === 'revise') {
          const failed = new Set(rd.tally.filter((x) => !x.passed).map((x) => x.plan));
          for (const m of rd.members) if (m.plans.some((v) => failed.has(v.plan) && v.stance !== '찬성') && !next.speakers.includes(m.memberId)) problems.push(`${tag} 라운드 ${next.round}: 불만인 ${m.memberId}가 빠짐`);
        }
      });
      // 같은 요청은 회의에서 한 번만 반영
      const keys = rounds.flatMap((rd) => rd.applied.filter((a) => a.applied).map((a) => `${a.plan}|${a.type}|${a.placeId}|${a.toId}`));
      if (new Set(keys).size !== keys.length) problems.push(`${tag}: 같은 요청을 두 번 반영`);
      // version: 안마다 1씩 오르고 결과의 안이 마지막 plan.proposed와 같음
      for (const p of result.plans) {
        const vs = events.filter((e) => e.type === 'plan.proposed' && e.data.planId === p.planId).map((e) => e.data.version);
        if (vs.some((v: number, i: number) => v !== i + 1)) problems.push(`${tag} ${p.label}: version ${vs.join(',')}`);
        if (vs.at(-1) !== p.version) problems.push(`${tag} ${p.label}: 결과 version ${p.version} ≠ 마지막 이벤트 ${vs.at(-1)}`);
        const sightIds = p.route.flatMap((d: { stops: { kind: string; placeId: string }[] }) => d.stops.filter((x) => x.kind === 'sight').map((x) => x.placeId));
        if (new Set(sightIds).size !== sightIds.length) problems.push(`${tag} ${p.label}: 같은 관광지가 두 번`);
      }
      // AI 횟수: 회의 상한 안, 모두 셈
      if (result.llmCalls !== llm.calls) problems.push(`${tag}: LLM 기록 ${result.llmCalls} ≠ 부른 수 ${llm.calls}`);
      if (result.llmCalls > 40) problems.push(`${tag}: LLM ${result.llmCalls}회 (상한 40)`);
      // 꼭 지킬 것: 1라운드에 지킨 규칙은 마지막 라운드에도 지킴
      for (const m of rounds[0].members)
        for (const f of m.facts)
          for (const x of f.musts.filter((y) => y.kept)) {
            const now = last.members.find((y) => y.memberId === m.memberId)?.facts.find((y) => y.plan === f.plan)?.musts.find((y) => y.rule === x.rule);
            if (now && !now.kept) problems.push(`${tag} ${f.plan}: ${m.memberId}의 꼭 지킬 것 ${x.rule}을 잃음`);
          }
      // 다듬기를 되돌렸으면 그 안의 평균은 다듬기 전과 같음
      if (last.reverted.length && rounds.length > 1)
        for (const l of last.reverted) {
          const before = rounds.at(-2)!.tally.find((x) => x.plan === l)!.average;
          const after = last.tally.find((x) => x.plan === l)!.average;
          if (Math.abs(before - after) > 1e-9) problems.push(`${tag} ${l}: 되돌렸는데 평균 ${before} → ${after}`);
        }
    }
    // 이 PC에서 크게 돌릴 때 끝난 까닭 분포를 파일로 남김 (시험 출력은 console을 감춤)
    if (process.env.SIM_OUT) writeFileSync(process.env.SIM_OUT, JSON.stringify({ outcomes, problems }, null, 2));
    expect(problems).toEqual([]);
    expect(Object.values(outcomes).reduce((a, b) => a + b, 0)).toBe(N);
  });

  it('7단계 평가: 보기 밖의 입장은 형식 오류로 1번 더 부르고, 그래도 틀리면 그 사람만 규칙 평가 (만족도는 코드 계산)', async () => {
    const base = pickLlm();
    const llm = fakeLlm(async (input, n, system, schema) => {
      if (input.plans && input.me.title === '반짝반짝 탐험가') return { ...evalAnswer(input), a: { why: '좋아요', stance: '약간 찬성' } };
      return base.generateJson({ system, input, schema, schemaName: 'test' });
    });
    const { app, token } = await readyTrip({ llm });
    const result = (await run(app, token)).lines.find((l) => l.kind === 'result');
    const byTitle = Object.fromEntries(result.members.map((m: { memberId: string; title: string }) => [m.title, result.evaluation.members.find((e: { memberId: string }) => e.memberId === m.memberId)]));
    expect(byTitle['반짝반짝 탐험가']).toMatchObject({ source: 'rule', llmCalls: EVAL.tries, fixes: [{ kind: 'failed', plan: null }] });
    expect(result.evaluation.members.filter((e: { source: string }) => e.source === 'llm')).toHaveLength(3);
    expect(evalCalls(result)).toBe(3 + EVAL.tries);
    for (const e of result.evaluation.members) for (const v of e.plans) expect(v.score).toBeGreaterThanOrEqual(0);
  });

  it('7단계 평가: LLM_REPLAY면 녹화된 같은 요청의 답을 다시 써 LLM 0회 (같은 입장·만족도)', async () => {
    const llm = pickLlm();
    const t = await readyTrip({ llm });
    const first = (await run(t.app, t.token)).lines.find((l) => l.kind === 'result');
    expect(evalCalls(first)).toBe(4);
    const replayApp = createApp({ db: t.db, rateLimitPerMinute: 1000, devUi: true, llm, llmReplay: true });
    const calls = llm.calls;
    const again = (await run(replayApp, t.token)).lines.find((l) => l.kind === 'result');
    expect(llm.calls).toBe(calls);
    expect(again.evaluation.members.every((e: { recorded: boolean; llmCalls: number }) => e.recorded && e.llmCalls === 0)).toBe(true);
    // 안 id(pln_)는 회의마다 새로 매기므로 빼고 비교
    const core = (r: { evaluation: { members: { memberId: string; plans: { planId: string }[] }[] } }) => r.evaluation.members.map((e) => [e.memberId, e.plans.map(({ planId: _, ...v }) => v)]);
    expect(core(again)).toEqual(core(first));
  });

  it('7단계 평가: 첫 시도가 형식 오류라 두 번째 답만 녹화된 사람도 LLM_REPLAY에서 그 녹화를 다시 씀 (규칙 평가로 바뀌지 않음)', async () => {
    const base = pickLlm();
    let tries = 0;
    const llm = fakeLlm(async (input, n, system, schema) => {
      if (input.plans && input.me.title === '반짝반짝 탐험가' && ++tries === 1) return { ...evalAnswer(input), a: { why: '좋아요', stance: '약간 찬성' } };
      return base.generateJson({ system, input, schema, schemaName: 'test' });
    });
    const t = await readyTrip({ llm });
    const first = (await run(t.app, t.token)).lines.find((l) => l.kind === 'result');
    expect(evalCalls(first)).toBe(4 + 1);
    const replayApp = createApp({ db: t.db, rateLimitPerMinute: 1000, devUi: true, llm, llmReplay: true });
    const again = (await run(replayApp, t.token)).lines.find((l) => l.kind === 'result');
    expect(again.evaluation.members.every((e: { source: string; recorded: boolean; llmCalls: number }) => e.source === 'llm' && e.recorded && e.llmCalls === 0)).toBe(true);
  });

  it('꼭 지킬 것 후보를 안 고르면 1번 더 부르고, 그래도 빠지면 마지막 장소를 꼭 지킬 것으로 바꿈', async () => {
    const llm = pickLlm(() => false, (title) => title === '느긋한 힐러'); // 서연(온천)은 계속 무시
    const { app, token } = await readyTrip({ llm });
    const result = (await run(app, token)).lines.find((l) => l.kind === 'result');
    const seoyeon = result.members.find((m: { title: string }) => m.title === '느긋한 힐러');
    const p = result.picks.find((x: { memberId: string }) => x.memberId === seoyeon.memberId);
    expect(p.llmCalls).toBe(PICK.tries);
    const spa = result.retrieve.candidates.find((c: { name: string }) => c.name === '태종대온천찜질방');
    expect(p.picks.map((x: { id: string }) => x.id)).toContain(spa.id);
    expect(p.picks).toHaveLength(PICK.count);
  });

  it('후보가 고를 수보다 적으면 LLM을 부르지 않고 규칙 고르기 (있는 곳만)', async () => {
    const llm = pickLlm();
    const { app, token, tripId } = await readyTrip({ llm });
    await call(app, 'PUT', `/trips/${tripId}/conditions`, { destination: '부산 영도구', startDate: '2099-11-07', endDate: '2099-11-07' }, token);
    const result = (await run(app, token)).lines.find((l) => l.kind === 'result');
    expect(result.retrieve.candidates.length).toBeLessThan(PICK.count);
    // 고르기는 0회. 이름 맞추기 2회: 영도구 목록 1번 + 맞는 곳이 없어 부산의 다른 구·군 목록 1번 (흰여울문화마을·돼지국밥이 영도구 시험 자료에 없음)
    expect(llm.calls).toBe(2);
    expect(result.llmCalls).toBe(2);
    expect(result.picks.every((p: { source: string; picks: unknown[] }) => p.source === 'rule' && p.picks.length === result.retrieve.candidates.length)).toBe(true);
  });

  it('하루 LLM 상한이면 부르지 않고 4명 모두 규칙 고르기, 실행 횟수는 여행당 상한까지', async () => {
    const llm = pickLlm();
    // 하루 상한 1: 조건 저장 때 여행지 확인 LLM 1번(시험용 흉내)이 쓰고 나면 회의에는 남지 않음
    const { app, db, token } = await readyTrip({ llm, llmDailyLimit: 1, meetingRunsPerTrip: 2 });
    const first = (await run(app, token)).lines.find((l) => l.kind === 'result');
    expect(first.picks.every((p: { source: string }) => p.source === 'rule')).toBe(true);
    expect(first.llmCalls).toBe(0);
    expect(llm.calls).toBe(0);
    expect((await run(app, token)).status).toBe(200);
    const third = await run(app, token);
    expect(third.status).toBe(409);
    expect(third.lines[0].error.code).toBe('MEETING_LIMIT');
    expect((await db.select().from(meetings)).length).toBe(2);
  });

  it('성향이 준비되지 않았으면 실행 횟수를 쓰지 않고 PERSONA_REQUIRED, 터널 요청은 403', async () => {
    const { app, db } = await createTestApp({ devUi: true });
    await seedDb(db);
    const t = await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' });
    await call(app, 'PUT', `/trips/${t.body.trip.id}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, t.body.token);
    const res = await run(app, t.body.token);
    expect(res.lines[0].error.code).toBe('PERSONA_REQUIRED');
    expect((await db.select().from(meetings)).length).toBe(0);
    expect((await run(app, t.body.token, { 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403);
  });
});

describe('4단계 후보 보드 반응 (코드, LLM 0회)', () => {
  const cand = (over: Partial<Candidate>): Candidate => ({
    id: 'c', name: '장소', type: 12, category: null, popularity: null, crowd: null, hours: null, open: null, restUnknown: false,
    summary: '', menu: null, lat: null, lng: null, scores: {}, total: 0, reasons: {}, marks: {}, forMembers: [], ...over,
  });
  const [minsu, jieun, hyunwoo, seoyeon] = MEMBERS;
  const at = (h: number, m = 0) => h * 60 + m;
  const react = (c: Candidate, who: MemberInput, opts: Partial<{ lodging: boolean; proposed: boolean }> = {}) => reactionOf(c, who, { lodging: false, proposed: false, ...opts });

  it('좋아요·꼭 지킬 것은 👍, 싫어요·혼잡 상한은 ⚠, 한 사람에게는 가장 무거운 반응 하나 (고른 사람의 👍는 붙이지 않음)', () => {
    const c = cand({ marks: { m1: [{ kind: 'like', label: '바다' }], m4: [{ kind: 'must', label: '온천 가기' }, { kind: 'crowd', label: '85' }], m2: [{ kind: 'dislike', label: '오래 걷기' }] } });
    expect(react(c, minsu)).toEqual({ kind: 'like', reason: '좋아요: 바다' });
    expect(react(c, minsu, { proposed: true })).toBeNull();
    expect(react(c, seoyeon)).toEqual({ kind: 'warn', reason: '혼잡 예측 85 (상한 80)' });
    expect(react(c, jieun)).toEqual({ kind: 'warn', reason: '싫어요: 오래 걷기' });
    expect(react(c, hyunwoo)).toBeNull();
  });

  it('영업시간이 하루 시간대와 안 겹치면 ✕, 조금만 겹치면 ⚠ (끝 시각을 안 정한 사람은 23:00까지, 자정 넘김 영업도 셈)', () => {
    expect(REACT.dayEnd).toBe('23:00');
    expect(react(cand({ open: { open: at(23, 30), close: at(2) } }), minsu)).toEqual({ kind: 'block', reason: '23:30부터 영업 (하루 일정은 23:00까지)' });
    expect(react(cand({ open: { open: at(5), close: at(9) } }), minsu)).toEqual({ kind: 'block', reason: '09:00에 영업 끝 (하루 일정은 09:30부터)' });
    expect(react(cand({ open: { open: at(22, 30), close: at(5) } }), minsu)).toEqual({ kind: 'warn', reason: '영업시간과 30분만 겹침 (22:30~05:00)' });
    const early = { ...minsu, profile: { ...minsu.profile, endTime: '21:00' } };
    expect(react(cand({ open: { open: at(18), close: at(2) } }), early)).toBeNull(); // 18:00–21:00 세 시간 겹침
    expect(react(cand({ open: { open: at(21, 30), close: at(2) } }), early)?.kind).toBe('block');
    expect(react(cand({ open: { open: 0, close: 1440 } }), minsu)).toBeNull(); // 상시
    expect(react(cand({ open: { open: at(23, 30), close: at(2) } }), minsu, { lodging: true })).toBeNull(); // 숙소는 영업시간을 보지 않음
    expect(react(cand({ open: null }), minsu)).toBeNull(); // 시간을 못 읽으면 반응 없음
    expect(overlapMinutes({ open: at(18), close: at(2) }, at(9, 30), at(23))).toBe(300);
    expect(react(cand({ open: { open: at(20), close: at(20, 20) } }), minsu)).toBeNull(); // 원래 20분짜리(분수 쇼)는 하루 시간대 안에 다 들어가면 ⚠ 아님
  });

  it('줄 서기 싫어요인 사람에게 인기도가 높은 음식점은 ⚠ (음식점만, 기준값 이상만)', () => {
    const queue = { ...hyunwoo, profile: { ...hyunwoo.profile, avoidQueue: true } };
    expect(react(cand({ type: 39, popularity: 90 }), queue)).toEqual({ kind: 'warn', reason: '인기가 많아서 줄 설 수도 있어요 (인기 90)' });
    expect(react(cand({ type: 39, popularity: REACT.queuePopularity - 1 }), queue)).toBeNull();
    expect(react(cand({ type: 12, popularity: 95 }), queue)).toBeNull();
    expect(react(cand({ type: 39, popularity: 95 }), hyunwoo)).toBeNull();
  });

  it('보드 전체: 반응을 붙이고 ✕ → ⚠ 많은 순으로 안건을 최대 5개, 반응 점수는 고름 +2 · 👍 +1 · ⚠ −1 · ✕ 제외', () => {
    const late = { open: at(23, 30), close: at(2) };
    const spots = [
      cand({ id: 's1', name: '광안리', marks: { m4: [{ kind: 'crowd', label: '85' }], m2: [{ kind: 'like', label: '바다' }] } }),
      cand({ id: 's2', name: '심야 바', open: late }),
      cand({ id: 's3', name: '장산', marks: { m4: [{ kind: 'dislike', label: '오래 걷기' }] } }),
      ...['s4', 's5', 's6', 's7'].map((id) => cand({ id, name: id, marks: { m2: [{ kind: 'dislike', label: '오래 걷기' }] } })),
    ];
    const pool = { candidates: spots, lodgings: [cand({ id: 'h1', name: '호텔', type: 32, open: late })] } as unknown as RetrieveResult;
    const row = (id: string, by: string[]) => ({ placeId: `plc_${id}`, name: id, lat: null, lng: null, proposedBy: by.map((m) => `agt_${m}`), reactions: [] });
    const board = reactBoard({ candidates: [row('s1', ['m1']), row('s2', ['m2']), row('s3', ['m1', 'm3']), ...['s4', 's5', 's6', 's7'].map((id) => row(id, ['m3'])), row('h1', ['m1'])], agenda: [] }, pool, MEMBERS);
    const s1 = board.candidates[0];
    expect(s1.reactions).toEqual([{ agentId: 'agt_m2', kind: 'like', reason: '좋아요: 바다' }, { agentId: 'agt_m4', kind: 'warn', reason: '혼잡 예측 85 (상한 80)' }]);
    expect(reactionScore(s1)).toEqual({ score: 2 + 1 - 1, blocked: false });
    expect(reactionScore(board.candidates[1])).toMatchObject({ blocked: true }); // 4명 모두 23:00까지라 ✕
    expect(board.candidates.at(-1)!.reactions).toEqual([]); // 숙소는 영업시간을 보지 않음
    expect(board.agenda).toHaveLength(REACT.agendaMax);
    expect(board.agenda[0].placeId).toBe('plc_s2');
    expect(board.agenda[0].text).toBe('s2 — 지은 고름 ↔ 민수 ✕ 23:30부터 영업 (하루 일정은 23:00까지) · 지은 ✕ 23:30부터 영업 (하루 일정은 23:00까지) · 현우 ✕ 23:30부터 영업 (하루 일정은 23:00까지) · 서연 ✕ 23:30부터 영업 (하루 일정은 23:00까지)');
    expect(board.agenda[1].text).toBe('s3 — 민수·현우 고름 ↔ 서연 ⚠ 싫어요: 오래 걷기'); // ⚠ 수가 같으면 고른 사람이 많은 곳 먼저 (이름은 보드의 이름)
  });

  it('AI 반응(사람이 쓴 말을 AI가 판단)은 코드 반응과 합쳐 더 무거운 쪽을 남기고, 같은 무게면 이유를 이어 붙임 → 새 ⚠는 안건이 됨', () => {
    const spots = [
      cand({ id: 's1', name: '광안리', marks: { m4: [{ kind: 'crowd', label: '85' }], m2: [{ kind: 'like', label: '바다' }] } }),
      cand({ id: 's2', name: '흰여울길' }),
    ];
    const pool = { candidates: spots, lodgings: [] } as unknown as RetrieveResult;
    const row = (id: string, by: string[]) => ({ placeId: `plc_${id}`, name: id, lat: null, lng: null, proposedBy: by.map((m) => `agt_${m}`), reactions: [] });
    const ai = new Map([
      ['agt_m2', [{ placeId: 'plc_s1', kind: 'warn' as const, reason: "계단이 많아요 ('계단')" }]], // 코드 👍보다 무거움 → ⚠
      ['agt_m4', [{ placeId: 'plc_s1', kind: 'warn' as const, reason: "시끄러워요 ('밤 공연')" }, { placeId: 'plc_s2', kind: 'like' as const, reason: "조용해요 ('한적')" }]],
      ['agt_m3', [{ placeId: 'plc_s2', kind: 'warn' as const, reason: "휠체어로 못 가요 ('가파른 골목')" }]],
    ]);
    const board = reactBoard({ candidates: [row('s1', ['m1']), row('s2', ['m1'])], agenda: [] }, pool, MEMBERS, ai);
    expect(board.candidates[0].reactions).toEqual([
      { agentId: 'agt_m2', kind: 'warn', reason: "계단이 많아요 ('계단')" },
      { agentId: 'agt_m4', kind: 'warn', reason: "혼잡 예측 85 (상한 80) · 시끄러워요 ('밤 공연')" },
    ]);
    expect(board.candidates[1].reactions).toEqual([
      { agentId: 'agt_m3', kind: 'warn', reason: "휠체어로 못 가요 ('가파른 골목')" },
      { agentId: 'agt_m4', kind: 'like', reason: "조용해요 ('한적')" },
    ]);
    expect(board.agenda.map((a) => a.placeId)).toEqual(['plc_s1', 'plc_s2']);
    expect(board.agenda[1].text).toBe("s2 — 민수 고름 ↔ 현우 ⚠ 휠체어로 못 가요 ('가파른 골목')");
  });

  it('AI 반응 요청은 그 사람이 고르지 않은 보드 장소만 넣고(숙소 포함), 근거가 그 장소 줄에 그대로 있을 때만 받음 (장소마다 가장 무거운 반응 하나)', () => {
    const spots = [cand({ id: 's1', name: '해변 카페', category: '음식 / 카페', summary: '반려동물 출입 금지. 바다 전망 테라스. 입구까지 계단 340개' }), cand({ id: 's2', name: '장산' })];
    const pool = { candidates: spots, lodgings: [cand({ id: 'h1', name: '바다 호텔', type: 32 })] } as unknown as RetrieveResult;
    const row = (id: string, by: string[]) => ({ placeId: `plc_${id}`, name: id, lat: null, lng: null, proposedBy: by.map((m) => `agt_${m}`), reactions: [] });
    const { req, rows, wishes } = reactRequest(seoyeon, pool, { candidates: [row('s1', ['m1']), row('s2', ['m4']), row('h1', ['m2'])], agenda: [] });
    expect(rows.map((r) => r.placeId)).toEqual(['plc_s1', 'plc_h1']); // 서연이 고른 장산은 빼고 숙소는 넣음
    // 바람 글: 소개글로 볼 좋아요·싫어요(야경 / 오래 걷기)는 '…좋아함/…싫어함', 꼭 넣을·피할 것과 바람은 그대로 (바다·온천 분류와 붐빔은 코드가 봄)
    expect(wishes).toEqual(['오래 걷기 싫어함', '온천 가기']);
    expect(req.schemaName).toBe('meeting_react');
    expect(req.thinking).toBe('medium');
    expect(req.input.me).toEqual({ wishes });
    expect((req.input.places as string).split('\n')).toEqual(['번호|이름|분류|소개', 'R1|해변 카페|음식/카페|반려동물 출입 금지. 바다 전망 테라스. 입구까지 계단 340개', 'R2|바다 호텔|-|-']);
    const got = acceptReactions(
      {
        checks: [
          { place: 'R1', evidence: '계단 340개', wish: '오래 걷기 싫어함', relation: '충돌', reason: '계단이 많아 힘들어요' },
          { place: 'r1', evidence: '바다 전망', wish: '온천 가기', relation: '충족', reason: '…' }, // 같은 장소의 더 가벼운 반응은 버림
          { place: 'R2', evidence: '반려동물 출입 금지', wish: '온천 가기', relation: '충족', reason: '…' }, // 다른 장소 줄의 글은 근거가 아님
          { place: 'R2', evidence: 'R2', wish: '온천 가기', relation: '충족', reason: '…' }, // 번호는 근거가 아님
          { place: 'R9', evidence: '바다', wish: '온천 가기', relation: '충족', reason: '…' }, // 표에 없는 번호
          { place: 'R2', evidence: '바다 호텔', wish: '바다', relation: '충족', reason: '…' }, // 바람 글에 없는 조건(좋아요 분류 바다는 코드가 봄)
          { place: ' 2 ', evidence: '바다 호텔', wish: ' 온천 가기 ', relation: '충족', reason: 'me의 likes에 맞음' }, // 번호를 R 없이 써도 같은 줄, 칸 이름이 나오면 근거만 보임
        ],
      },
      rows,
      wishes,
    );
    expect(got).toEqual([
      { placeId: 'plc_s1', kind: 'warn', reason: "계단이 많아 힘들어요 ('계단 340개')" },
      { placeId: 'plc_h1', kind: 'like', reason: "'바다 호텔'" },
    ]);
  });

  it('AI 반응의 바람 글: 소개글로 볼 좋아요·싫어요는 …좋아함/…싫어함, 꼭 넣을·피할 것과 바람은 그대로, 같은 글은 하나만. 바람 글이 없는 사람은 부르지 않음', () => {
    const rule = (type: 'include' | 'avoid' | 'budget', label: string) => ({ type, label, quote: label, keyword: null, start: null, end: null, amount: null });
    // 분류·숫자로 코드가 보는 것(바다·붐비는 곳·예산)만 있는 사람 → 빈 목록 (graph가 LLM을 부르지 않음)
    expect(reactWishes({ likes: ['like_sea'], dislikes: ['dislike_crowd'], mustKeep: [rule('budget', '30만 원 안')], wishes: [] })).toEqual([]);
    expect(reactWishes({ likes: ['like_night', 'like_sea'], dislikes: ['dislike_walk'], mustKeep: [rule('include', '회 먹기'), rule('avoid', '찜질방 피하기')], wishes: ['회 먹기', '반려견과 함께'] })).toEqual([
      '야경 좋아함',
      '오래 걷기 싫어함',
      '회 먹기',
      '찜질방 피하기',
      '반려견과 함께',
    ]);
  });

  it('여행지 밖에서 넣은 곳은 안건으로 올리고, 넣지 못한 꼭 지킬 것(지역)은 메모로 붙임', () => {
    const far = cand({ id: 'f1', name: '태종대온천찜질방', outside: '영도구', marks: { m4: [{ kind: 'must', label: '온천 가기' }] } });
    const pool = {
      candidates: [far],
      lodgings: [],
      outsideRules: [
        { memberId: 'm4', label: '온천 가기', district: '영도구', placeId: 'f1' },
        { memberId: 'm2', label: '해운대 가기', district: '해운대구', placeId: null },
      ],
    } as unknown as RetrieveResult;
    const board = reactBoard({ candidates: [{ placeId: 'plc_f1', name: '태종대온천찜질방', lat: null, lng: null, proposedBy: ['agt_m4'], reactions: [] }], agenda: [] }, pool, MEMBERS);
    expect(board.agenda).toEqual([
      { placeId: 'plc_f1', text: '태종대온천찜질방 — 서연 고름 · 여행지 밖(영도구)' },
      { placeId: null, text: "지은의 꼭 지킬 것 '해운대 가기' — 여행지 밖(해운대구)이라 후보에 넣지 못함" },
    ]);
  });

  it('여행지 밖·이름 맞춤인 곳(사람이 확인하기로 한 곳)을 안건 앞에 두고, 상한에 잘린 그런 곳은 메모로 남김 (사람 확인 없이 일정에 들어가지 않게)', () => {
    const warn = (m: string) => ({ agentId: `agt_${m}`, kind: 'warn' as const, reason: '싫어요: 오래 걷기' });
    const row = (id: string, by: string, reactions: ReturnType<typeof warn>[]) => ({ placeId: `plc_${id}`, name: id, lat: null, lng: null, proposedBy: [`agt_${by}`], reactions });
    const busy = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => row(id, 'm1', [warn('m2'), warn('m3')]));
    const named = new Map([['plc_n1', "이름이 달라 AI가 맞춘 서연의 꼭 지킬 곳 ('엘시티 전망대')"]]);
    const outside = new Map(['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => [`plc_${id}`, '기장군']));
    const agenda = agendaOf([...busy, row('n1', 'm4', []), ...['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => row(id, 'm3', []))], MEMBERS, { named, outside, notes: ['메모'] });
    expect(agenda.filter((a) => a.placeId).map((a) => a.placeId)).toEqual(['plc_n1', 'plc_o1', 'plc_o2', 'plc_o3', 'plc_o4']);
    // 잘린 o5(여행지 밖)는 메모로, 잘린 s1–s6(⚠만)은 메모로 남기지 않음
    expect(agenda.filter((a) => !a.placeId).map((a) => a.text)).toEqual([`o5 — 여행지 밖(기장군) (안건 상한 ${REACT.agendaMax}개를 넘어 메모로 남김)`, '메모']);
  });
});

describe('3단계 입력 표·자기 조건 (코드)', () => {
  const cand = (over: Partial<Candidate>): Candidate => ({
    id: 'c', name: '장소', type: 12, category: null, popularity: null, crowd: null, hours: null, open: null, restUnknown: false,
    summary: '', menu: null, lat: null, lng: null, scores: {}, total: 0, reasons: {}, marks: {}, forMembers: [], ...over,
  });
  const seoyeon = MEMBERS[3]; // 붐비는 곳·오래 걷기 싫어요, 혼잡 상한 80
  const crowded = cand({ id: 'a', name: '수성동계곡', crowd: 96, popularity: 1, summary: '인왕산 자락 계곡', marks: { m4: [{ kind: 'crowd', label: '96' }] }, scores: { m4: 5 }, forMembers: ['m4'] });
  const sea = cand({ id: 'b', name: '광안리', crowd: 20, popularity: 80, marks: { m4: [{ kind: 'like', label: '바다' }] }, scores: { m4: 4 }, forMembers: ['m4'] });
  const food = cand({ id: 'c', name: '신창국밥', type: 39, menu: '돼지국밥', summary: '맑은 육수', scores: { m4: 1 } });
  const quiet = cand({ id: 'd', name: '송정해수욕장', crowd: 40, popularity: 50, scores: { m4: 3 }, forMembers: ['m4'] });
  const pool = { nights: 0, candidates: [crowded, sea, food, quiet], lodgings: [] } as unknown as RetrieveResult;

  it('표에 숫자의 뜻과 그 사람 기준에 걸리는지(내 조건)를 코드가 적어 줌', () => {
    const rows = pickTables(pool, seoyeon).candidates.split('\n');
    expect(rows[0]).toBe('번호|이름|분류|인기|혼잡|영업|내 조건|소개');
    expect(rows[1]).toBe('1|수성동계곡|-|1(덜 알려짐)|96(매우 붐빔)|-|⚠ 혼잡 예측 96 (상한 80)|인왕산 자락 계곡');
    expect(rows[2]).toBe('2|광안리|-|80(이름난 곳)|20(한산)|-|👍 좋아요: 바다|-');
    expect(rows[3]).toContain('|메뉴: 돼지국밥 · 맑은 육수');
  });

  it('여행지 밖에서 넣은 곳은 소개 칸 앞에 여행지 밖(시·군·구)을 적음', () => {
    const far = cand({ id: 'e', name: '태종대온천찜질방', outside: '영도구', summary: '온천과 찜질방' });
    const rows = pickTables({ ...pool, candidates: [far] } as unknown as RetrieveResult, seoyeon).candidates.split('\n');
    expect(rows[1]).toBe('1|태종대온천찜질방|-|-|-|-|-|여행지 밖(영도구) · 온천과 찜질방');
  });

  it('자기 조건에 걸린 곳은 걸리지 않는 점수 상위(자기 몫 먼저)로 바꾸고, 꼭 지킬 것은 걸려도 그대로 둠', () => {
    expect([...ownConflictIds(seoyeon, pool)]).toEqual(['a']);
    const picked = { memberId: 'm4', source: 'llm' as const, picks: [{ id: 'a', reason: '한적해요' }, { id: 'b', reason: '바다' }, { id: 'c', reason: '국밥' }], lodging: null, comment: '', llmCalls: 2 };
    expect(ensureOwnLimits(picked, seoyeon, pool).picks.map((p) => p.id)).toEqual(['d', 'b', 'c']);
    const mustCrowded = { ...crowded, reasons: { m4: ['꼭 지킬 것: 계곡 가기'] }, marks: { m4: [{ kind: 'must' as const, label: '계곡 가기' }, ...crowded.marks.m4] } };
    const mustPool = { ...pool, candidates: [mustCrowded, sea, food, quiet] } as unknown as RetrieveResult;
    expect(ownConflictIds(seoyeon, mustPool).size).toBe(0);
    expect(ensureOwnLimits(picked, seoyeon, mustPool).picks.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('하루 시간에 닫혀 ✕인 꼭 지킬 곳은 같은 규칙을 채우는 다른 후보가 있을 때만 바꾸고, 그곳뿐이면 그대로 둠 (4단계 안건에서 사람이 정함)', () => {
    const market = (id: string, open: { open: number; close: number } | null) => cand({ id, name: `시장${id}`, open, marks: { m4: [{ kind: 'must', label: '시장 가기' }] }, scores: { m4: 2 }, forMembers: ['m4'] });
    const night = market('n', { open: 120, close: 300 }); // 새벽 2–5시만 열어 서연의 하루와 겹치지 않음 → ✕
    expect(ownConflictIds(seoyeon, { ...pool, candidates: [night, sea, food, quiet] } as unknown as RetrieveResult).has('n')).toBe(false);
    expect(ownConflictIds(seoyeon, { ...pool, candidates: [night, market('day', null), sea, quiet] } as unknown as RetrieveResult).has('n')).toBe(true);
  });
});

describe('이름 맞추기 (2단계, LLM, 10/29 사용자 결정 \'가\')', () => {
  const rules: NameRule[] = [
    { key: 'a', type: 'include', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', target: 'place' },
    { key: 'b', type: 'include', label: '곰장어 먹기', keyword: '곰장어 구이', target: 'food' },
  ];
  const list: NamePlace[] = [
    { id: 'x', title: '부산엑스더스카이', category: '타워/전망대', district: '해운대구', isFood: false, menu: null, summary: '해운대 엘시티 100층 전망대', popularity: 90 },
    { id: 'y', title: '자갈치꼼장어', category: '관광식당', district: '중구', isFood: true, menu: '꼼장어구이, 장어탕', summary: null, popularity: null },
    { id: 'z', title: '해운대 전망 카페', category: '카페', district: '해운대구', isFood: true, menu: '커피', summary: null, popularity: null },
  ];

  it('설명문은 10/28 비교 시험(92.0%)의 글 그대로 (녹화 지문이 같아야 재생됨)', () => {
    expect(createHash('sha256').update(SYSTEM).digest('hex')).toBe('343d016f54fa0479c0c5f108c4fcebde135a0172ba0551347eaadb8aed01a136');
  });

  it('후보는 글자 겹침·인기 순으로 줄여 짧은 번호로 보내고, 답의 번호를 id로 되돌림 (없는 번호·없는 규칙은 버리고, 보낸 규칙은 모두 답한 것으로 남김)', () => {
    const { codes, input } = nameInput(rules, list);
    expect(input.rules).toEqual(['1|장소|엘시티 전망대', '2|음식|곰장어 구이']);
    expect(input.places).toContain('부산엑스더스카이'); // 이름이 전혀 달라도 인기 상위라 들어감
    expect(input.places).toContain('메뉴: 꼼장어구이'); // 음식은 메뉴 글자 겹침
    const codeOf = (id: string) => [...codes].find(([, v]) => v === id)![0];
    const back = decodeNames({ matches: [{ rule: 1, evidence: '소개에 엘시티 전망대', places: [codeOf('x'), 'P99'] }, { rule: 9, evidence: '-', places: [codeOf('y')] }] }, rules, codes);
    expect(back.get('a')).toEqual(['x']);
    expect(back.get('b')).toEqual([]); // 답에 없는 규칙도 '답함(맞는 곳 없음)'
    expect(input.places).toContain('엘시티'); // 소개 조각: 규칙 글자가 나오는 곳 둘레
  });

  it('넣기는 2곳·피하기는 4곳까지 받음 (그 장소 안의 시설까지 빼려고)', () => {
    const many = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const codes = new Map(many.map((c, i) => [c, `id${i}`]));
    const two: NameRule[] = [
      { key: 'in', type: 'include', label: '월드 가기', keyword: '월드', target: 'place' },
      { key: 'out', type: 'avoid', label: '월드 빼기', keyword: '월드', target: 'place' },
    ];
    const back = decodeNames({ matches: [{ rule: 1, evidence: '-', places: many }, { rule: 2, evidence: '-', places: many }] }, two, codes);
    expect(back.get('in')).toHaveLength(NAME_MATCH.pickMax);
    expect(back.get('out')).toHaveLength(NAME_MATCH.avoidPickMax);
  });

  it('규칙이 있을 때 LLM을 부르고, 상한이면 부르지 않으며(답 없음), 실패하면 답 없음 — 코드가 글자로 대신 맞추지 않음', async () => {
    const llm = fakeLlm(() => ({ matches: [{ rule: 1, evidence: '같은 곳', places: ['P1'] }] }));
    const out = await nameMatcher(llm, async () => true)(rules, list);
    expect(llm.calls).toBe(1);
    expect([...out.keys()].sort()).toEqual(['a', 'b']); // b는 '맞는 곳 없음'
    expect(out.get('b')).toEqual([]);
    const blocked = fakeLlm(() => ({ matches: [] }));
    expect((await nameMatcher(blocked, async () => false)(rules, list)).size).toBe(0);
    expect(blocked.calls).toBe(0);
    const broken = fakeLlm(() => {
      throw new Error('boom');
    });
    expect((await nameMatcher(broken, async () => true)(rules, list)).size).toBe(0);
  });

  it('규칙이 6개를 넘으면 나눠 묻고, 회의 1번에 LLM은 maxCalls번까지 (넘는 규칙은 답 없음)', async () => {
    const lots: NameRule[] = Array.from({ length: NAME_MATCH.maxRules * (NAME_MATCH.maxCalls + 1) }, (_, i) => ({ key: `k${i}`, type: 'include', label: `곳${i}`, keyword: `곳${i}`, target: 'place' }));
    const llm = fakeLlm((input) => ({ matches: (input.rules as string[]).map((_, i) => ({ rule: i + 1, evidence: '없음', places: [] })) }));
    const match = nameMatcher(llm, async () => true);
    const out = await match(lots, list);
    expect(llm.calls).toBe(NAME_MATCH.maxCalls);
    expect(out.size).toBe(NAME_MATCH.maxRules * NAME_MATCH.maxCalls);
    // 같은 회의의 두 번째 맞추기(여행지 밖)도 같은 상한을 씀
    expect((await match(rules, list)).size).toBe(0);
    expect(llm.calls).toBe(NAME_MATCH.maxCalls);
  });

  it('지난 회의에서 맞춘 규칙은 다시 쓰고 나머지 규칙만 LLM에 물음 (하나 맞춘 게 있다고 나머지를 버리지 않음)', async () => {
    const asked: string[][] = [];
    const llm = fakeLlm((input) => {
      asked.push(input.rules as string[]);
      return { matches: [{ rule: 1, evidence: '같은 음식', places: ['P1'] }] };
    });
    const saved = savedNameMatcher([{ label: '엘시티 전망대 가기', keyword: '엘시티 전망대', places: ['부산엑스더스카이'], ids: ['x'] }]);
    const out = await nameMatcher(llm, async () => true, { saved })(rules, list);
    expect(asked).toEqual([['1|음식|곰장어 구이']]);
    expect(out.get('a')).toEqual(['x']);
    expect(out.get('b')?.length).toBe(1);
    // 모두 맞춘 게 있으면 LLM을 부르지 않음
    const both = savedNameMatcher([
      { label: '엘시티 전망대 가기', keyword: '엘시티 전망대', places: [], ids: ['x'] },
      { label: '곰장어 먹기', keyword: '곰장어 구이', places: [], ids: ['y'] },
    ]);
    const quiet = fakeLlm(() => ({ matches: [] }));
    expect((await nameMatcher(quiet, async () => true, { saved: both })(rules, list)).size).toBe(2);
    expect(quiet.calls).toBe(0);
    // 피하기 규칙은 종류가 같은 기록만 씀 (10/29 전 기록은 넣기)
    const avoid: NameRule[] = [{ key: 'v', type: 'avoid', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', target: 'place' }];
    expect((await saved(avoid, list)).size).toBe(0);
  });
});

describe('5단계 사람 확인 규칙 (코드, LLM 0회)', () => {
  const cand = (over: Partial<Candidate>): Candidate => ({
    id: 'c', name: '장소', type: 12, category: null, popularity: null, crowd: null, hours: null, open: null, restUnknown: false,
    summary: '', menu: null, lat: null, lng: null, scores: {}, total: 0, reasons: {}, marks: {}, forMembers: [], ...over,
  });
  const row = (id: string, name: string, by: string[]) => ({ placeId: `plc_${id}`, name, lat: null, lng: null, proposedBy: by.map((m) => `agt_${m}`), reactions: [] });
  const spa = cand({ id: 'spa', name: '산방산탄산온천', marks: { m4: [{ kind: 'must', label: '온천 가기' }, { kind: 'crowd', label: '98' }] } });
  const trail = cand({ id: 'trail', name: '장산', marks: { m4: [{ kind: 'dislike', label: '오래 걷기' }] } });
  const pool = {
    candidates: [spa, trail],
    lodgings: [],
    outsideRules: [],
    nameMatches: [],
    missingRules: [{ memberId: 'm3', label: '돼지국밥 먹기', reason: '여행지 자료에서 찾지 못함' }],
  } as unknown as RetrieveResult;
  const board = reactBoard({ candidates: [row('spa', '산방산탄산온천', ['m4']), row('trail', '장산', ['m1'])], agenda: [] }, pool, MEMBERS);

  it('고른 사람 자신의 꼭 지킬 곳에 걸린 ⚠는 "꼭 지킬 곳이지만"으로 적음 (다른 사람의 ⚠는 ↔ 뒤에)', () => {
    expect(board.agenda.find((a) => a.placeId === 'plc_spa')!.text).toBe('산방산탄산온천 — 서연 고름 · 서연의 꼭 지킬 곳이지만 ⚠ 혼잡 예측 98 (상한 80)');
    expect(board.agenda.find((a) => a.placeId === 'plc_trail')!.text).toBe('장산 — 민수 고름 ↔ 서연 ⚠ 싫어요: 오래 걷기');
  });

  it('고르는 안건은 장소 안건, 메모는 보기만 함. 빼면 꼭 지킬 것을 지킬 곳이 보드에 없어지면 그 사실을 붙임', () => {
    const request = reviewRequestOf(board, pool, MEMBERS);
    expect(request.items.map((i) => i.placeId).sort()).toEqual(['plc_spa', 'plc_trail']);
    expect(request.items.find((i) => i.placeId === 'plc_spa')).toMatchObject({ name: '산방산탄산온천', consequence: "빼면 서연의 '온천 가기'를 지킬 곳이 없어짐" });
    expect(request.items.find((i) => i.placeId === 'plc_trail')!.consequence).toBeNull();
    expect(request.memos).toEqual(["현우의 꼭 지킬 것 '돼지국밥 먹기' — 여행지 자료에서 찾지 못함"]);
    // 같은 꼭 지킬 것을 채우는 곳이 보드에 하나 더 있으면 빼도 지킬 수 있음
    const other = cand({ id: 'spa2', name: '해운대온천', marks: { m4: [{ kind: 'must', label: '온천 가기' }] } });
    const two = { ...pool, candidates: [spa, trail, other] } as unknown as RetrieveResult;
    const both = reactBoard({ candidates: [row('spa', '산방산탄산온천', ['m4']), row('trail', '장산', ['m1']), row('spa2', '해운대온천', ['m4'])], agenda: [] }, two, MEMBERS);
    expect(reviewRequestOf(both, two, MEMBERS).items.find((i) => i.placeId === 'plc_spa')!.consequence).toBeNull();
    // 안건이 없으면 고를 것이 없음 (회의가 멈추지 않음)
    expect(reviewRequestOf({ candidates: [], agenda: [{ placeId: null, text: '메모' }] }, pool, MEMBERS)).toEqual({ items: [], memos: ['메모'] });
  });

  it('안건마다 다수결, 같으면 방장의 응답으로 정하고, 응답하지 않은 사람은 남김으로 셈. 뺀 곳은 보드·안건에서 지움', () => {
    const request = reviewRequestOf(board, pool, MEMBERS);
    const people = MEMBERS.map((m, i) => ({ id: m.memberId, isHost: i === 0 }));
    const responses = new Map([
      ['m1', [{ placeId: 'plc_trail', keep: false }, { placeId: 'plc_spa', keep: true }]],
      ['m2', [{ placeId: 'plc_trail', keep: false }, { placeId: 'plc_spa', keep: true }]],
      ['m3', [{ placeId: 'plc_trail', keep: true }, { placeId: 'plc_spa', keep: false }]],
    ]);
    expect(REVIEW.defaultKeep).toBe(true);
    const decision = tallyReview(request, responses, people, 'host');
    // 장산: 뺌 2(민수·지은) · 남김 2(현우·응답 안 한 서연) → 같아서 방장(민수, 뺌)으로 정함
    expect(decision.votes.find((v) => v.placeId === 'plc_trail')).toEqual({ placeId: 'plc_trail', keep: 2, drop: 2, tie: true, kept: false });
    expect(decision.votes.find((v) => v.placeId === 'plc_spa')).toEqual({ placeId: 'plc_spa', keep: 3, drop: 1, tie: false, kept: true });
    expect(decision).toMatchObject({ kept: ['plc_spa'], dropped: ['plc_trail'], responded: ['m1', 'm2', 'm3'], defaulted: ['m4'], closedBy: 'host' });
    const after = applyReview(board, decision);
    expect(after.candidates.map((c) => c.placeId)).toEqual(['plc_spa']);
    expect(after.agenda.map((a) => a.placeId)).toEqual(['plc_spa', null]);
  });
});

/** 회의를 뒤에서 돌리고 상태를 기다리는 시험이라 CI(느린 컴퓨터)에서도 넉넉하게 둠 (이 PC에서는 1–2초) */
const STEP5_TIMEOUT_MS = 15_000;

describe('5단계 사람 확인 (공식 API · WebSocket)', () => {
  /** 가짜 LLM: 내 조건에 걸리지 않으면 장산을 먼저 고름 → 오래 걷기 싫어요인 서연에게 ⚠가 붙어 안건이 생김 */
  const jangsanLlm = () =>
    fakeLlm((input) => {
      if (input.areas !== undefined) return areaAnswer(input);
      if (input.rules) return nameAnswer(input); // 2단계 이름 맞추기 (흰여울문화마을은 시험 자료에 없음)
      if (input.plans) return evalAnswer(input); // 7단계 평가: 모두 찬성
      if (input.places) return { checks: [] }; // 4단계 AI 반응: 반응 없음
      const rows = (input.candidates as string).split('\n').slice(1).map((l) => l.split('|'));
      const ok = rows.filter((r) => !/^[⚠✕]/.test(r[6] ?? ''));
      const ids = [...new Set([...input.me.mustKeepIds, ...ok.filter((r) => r[1] === '장산').map((r) => r[0]), ...ok.map((r) => r[0])])].slice(0, PICK.count);
      const lodging = (input.lodgings as string) ? (input.lodgings as string).split('\n')[1].split('|')[0] : '';
      return { picks: ids.map((id) => ({ id, reason: '좋아요' })), lodging: { id: lodging, reason: lodging ? '편해요' : '' }, comment: '가요!' };
    });
  async function reviewTrip(options: Parameters<typeof createTestApp>[0] = {}) {
    const t = await createTestApp(options);
    await seedDb(t.db);
    const demo = await call(t.app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
    const token = demo.body.token as string;
    const tripId = demo.body.trip.id as string;
    await call(t.app, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_night', 'like_sea'], []) }, token, { 'cf-connecting-ip': '203.0.113.7' });
    await call(t.app, 'PUT', `/trips/${tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08' }, token);
    const people = (await t.db.select().from(members).where(eq(members.tripId, tripId))).sort((a, b) => a.seat - b.seat);
    return { ...t, token, tripId, people };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until<T>(get: () => Promise<T> | T, ok: (v: T) => boolean, what: string) {
    for (let i = 0; i < 300; i++) {
      const v = await get();
      if (ok(v)) return v;
      await sleep(20);
    }
    throw new Error(`기다려도 되지 않음: ${what}`);
  }
  type App = Awaited<ReturnType<typeof createTestApp>>['app'];
  const meetingOf = async (app: App, token: string, id: string) => (await call(app, 'GET', `/meetings/${id}`, undefined, token)).body.meeting;
  const waitStatus = (app: App, token: string, id: string, status: string) => until(() => meetingOf(app, token, id), (m) => m?.status === status, `회의 ${status}`);

  it('고를 안건이 있으면 멈추고, 응답·덮어쓰기·대리 응답 뒤 방장 마감(2:2는 방장)으로 정해 이어서 실행함 (LLM 횟수 그대로)', async () => {
    const { app, db, token, tripId, people } = await reviewTrip({ llm: jangsanLlm() });
    const [host, jieun, hyunwoo, seoyeon] = people;
    const started = await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token);
    expect(started.status).toBe(202);
    expect(started.body.meeting).toMatchObject({ status: 'researching', maxRounds: 5 });
    const id = started.body.meeting.id as string;
    const waiting = await waitStatus(app, token, id, 'reviewing');
    const item = waiting.review.items.find((i: { name: string }) => i.name === '장산');
    expect(item.text).toContain('서연 ⚠ 싫어요: 오래 걷기');
    expect(waiting.review).toMatchObject({ total: 4, responded: [], mine: null, decision: null });

    // 회의 중: 여행 상태 meeting → 조건·성향을 바꾸거나 새 회의를 시작할 수 없음
    expect((await call(app, 'GET', `/trips/${tripId}`, undefined, token)).body.trip.status).toBe('meeting');
    expect((await call(app, 'PUT', `/trips/${tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, token)).body.error.code).toBe('MEETING_IN_PROGRESS');
    expect((await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token)).body.error.code).toBe('MEETING_IN_PROGRESS');

    // 응답 검사: 없는 안건·빠진 안건은 400, 다른 여행 구성원은 403
    const choose = (drop: string[]) => waiting.review.items.map((i: { placeId: string }) => ({ placeId: i.placeId, keep: !drop.includes(i.placeId) }));
    expect((await call(app, 'POST', `/meetings/${id}/review`, { choices: [...choose([]), { placeId: 'plc_없음', keep: true }] }, token)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await call(app, 'POST', `/meetings/${id}/review`, { choices: choose([]).slice(1) }, token)).body.error.code).toBe('VALIDATION_ERROR');
    const stranger = await call(app, 'POST', '/trips', { title: '다른 여행', nickname: '손님' });
    expect((await call(app, 'POST', `/meetings/${id}/review`, { choices: choose([]) }, stranger.body.token)).status).toBe(403);
    expect((await call(app, 'GET', `/meetings/${id}`, undefined, stranger.body.token)).status).toBe(403);
    expect((await call(app, 'GET', `/trips/${tripId}/events`, undefined, stranger.body.token)).status).toBe(403);

    // 방장: 장산 뺌 · 지은(방장이 대신): 남김 → 다시 내서 뺌(덮어씀) · 현우(직접): 남김 · 서연: 응답 안 함
    await db.update(members).set({ tokenHash: hashToken('tok_hyunwoo') }).where(eq(members.id, hyunwoo.id));
    expect((await call(app, 'POST', `/meetings/${id}/review`, { choices: choose([item.placeId]) }, token)).body.meeting.review.responded).toEqual([host.id]);
    await call(app, 'POST', `/meetings/${id}/review`, { memberId: jieun.id, choices: choose([]) }, token);
    const over = await call(app, 'POST', `/meetings/${id}/review`, { memberId: jieun.id, choices: choose([item.placeId]) }, token);
    expect(over.body.meeting.review.responded).toEqual([host.id, jieun.id]);
    expect((await call(app, 'POST', `/meetings/${id}/review`, { memberId: seoyeon.id, choices: choose([]) }, 'tok_hyunwoo')).status).toBe(403); // 방장이 아니면 남의 몫을 낼 수 없음
    const mine = await call(app, 'POST', `/meetings/${id}/review`, { choices: choose([]) }, 'tok_hyunwoo');
    expect(mine.body.meeting.review.mine).toEqual(choose([]));
    expect((await call(app, 'POST', `/meetings/${id}/review/close`, undefined, 'tok_hyunwoo')).status).toBe(403); // 마감은 방장만

    // 방장 '진행': 서연은 남김으로 셈 → 장산 2:2 → 방장(뺌)으로 정함
    expect((await call(app, 'POST', `/meetings/${id}/review/close`, undefined, token)).status).toBe(200);
    const done = await waitStatus(app, token, id, 'done');
    expect(done.review.decision.votes.find((v: { placeId: string }) => v.placeId === item.placeId)).toEqual({ placeId: item.placeId, keep: 2, drop: 2, tie: true, kept: false });
    expect(done.review.decision).toMatchObject({ closedBy: 'host', responded: [host.id, jieun.id, hyunwoo.id], defaulted: [seoyeon.id] });
    expect(done.llmCalls).toBe(waiting.llmCalls + 4); // 5·6단계는 LLM 0회, 이어서 7단계 평가 4명 1회씩

    // 이벤트: review.requested → review.cast ×4(덮어쓰기 포함) → review.closed → board.updated(장산 빠짐), seq는 이어짐
    const { events } = (await call(app, 'GET', `/trips/${tripId}/events?afterSeq=0`, undefined, token)).body;
    expect(events.map((e: { seq: number }) => e.seq)).toEqual(events.map((_: unknown, i: number) => i + 1));
    const tail = events.slice(events.findIndex((e: { type: string }) => e.type === 'review.requested'));
    expect(tail.map((e: { type: string }) => e.type)).toEqual(['review.requested', 'review.cast', 'review.cast', 'review.cast', 'review.cast', 'review.closed', 'board.updated', 'plan.proposed', 'plan.proposed', 'round.started', ...Array(4).fill(['agent.message', 'vote.cast', 'vote.cast']).flat()]);
    expect(tail[0].data).toMatchObject({ meetingId: id, total: 4, items: waiting.review.items });
    expect(tail[4].data).toMatchObject({ memberId: hyunwoo.id, answered: 3, total: 4 });
    expect(tail[5].data).toMatchObject({ meetingId: id, dropped: [item.placeId] });
    expect(tail[6].data.candidates.some((c: { placeId: string }) => c.placeId === item.placeId)).toBe(false);

    // 마감 뒤에는 응답·마감 모두 409 (두 번 이어서 실행되지 않음)
    expect((await call(app, 'POST', `/meetings/${id}/review`, { choices: choose([]) }, token)).body.error.code).toBe('REVIEW_CLOSED');
    expect((await call(app, 'POST', `/meetings/${id}/review/close`, undefined, token)).body.error.code).toBe('REVIEW_CLOSED');
  }, STEP5_TIMEOUT_MS);

  it('4명이 모두 내면 바로 마감하고 이어서 실행함 (자동 마감, 응답하지 않은 사람 없음)', async () => {
    const { app, token, tripId, people } = await reviewTrip({ llm: jangsanLlm() });
    const id = (await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token)).body.meeting.id as string;
    const waiting = await waitStatus(app, token, id, 'reviewing');
    const keepAll = waiting.review.items.map((i: { placeId: string }) => ({ placeId: i.placeId, keep: true }));
    for (const p of people) await call(app, 'POST', `/meetings/${id}/review`, { memberId: p.id, choices: keepAll }, token);
    const done = await waitStatus(app, token, id, 'done');
    expect(done.review.decision).toMatchObject({ closedBy: 'all', defaulted: [], dropped: [] });
    expect(done.review.decision.responded).toEqual(people.map((p) => p.id));
  }, STEP5_TIMEOUT_MS);

  it('LLM_REPLAY: 같은 여행을 다시 실행하면 지난 회의에서 AI가 고른 곳을 그대로 써 LLM 0회로 사람 확인까지 가고, 그 뒤 성향을 바꾼 사람·조건이 바뀐 여행은 규칙으로 고름', async () => {
    const llm = jangsanLlm();
    const checkpointer = new MemorySaver();
    const runs = { meetingRunsPerTrip: 10 }; // 같은 여행을 여러 번 실행함
    const t = await reviewTrip({ llm, devUi: true, checkpointer, ...runs });
    const replayApp = createApp({ db: t.db, rateLimitPerMinute: 1000, devUi: true, llm, llmReplay: true, checkpointer, ...runs });
    const runOn = async (app: App) => {
      const res = await app.request('/api/v1/dev/meeting/run', { method: 'POST', headers: { Authorization: `Bearer ${t.token}` } });
      return (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.kind === 'result');
    };
    type Pick = { memberId: string; source: string; picks: unknown[]; lodging: unknown; comment: string; llmCalls: number; savedFrom?: string };
    const core = (list: Pick[]) => [...list].sort((a, b) => a.memberId.localeCompare(b.memberId)).map(({ memberId, picks, lodging, comment }) => ({ memberId, picks, lodging, comment }));

    const first = await runOn(t.app);
    expect(first.llmCalls).toBe(4 + 1 + reactCalls(first)); // 고르기 4 + 이름 맞추기 1 + 4단계 AI 반응
    const calls = llm.calls;
    const again = await runOn(replayApp);
    expect(again).toMatchObject({ replay: true, llmCalls: 0, status: 'reviewing' });
    expect(llm.calls).toBe(calls); // LLM을 한 번도 부르지 않음
    expect(core(again.picks)).toEqual(core(first.picks));
    expect(again.picks.every((p: Pick) => p.source === 'llm' && p.llmCalls === 0 && p.savedFrom === first.meetingId)).toBe(true);
    expect(again.review).toEqual(first.review); // 같은 고르기 → 같은 안건에서 멈춤
    // 다시 쓴 결과를 또 다시 써도 처음 AI가 고른 회의를 가리킴
    expect((await runOn(replayApp)).picks.every((p: Pick) => p.savedFrom === first.meetingId)).toBe(true);

    // 방장이 성향을 다른 응답으로 바꿈 → 카드도 LLM 없이(같은 응답의 AI 카드가 없어 규칙), 회의에서는 방장 몫만 규칙
    const host = t.people[0].id;
    expect((await call(replayApp, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_sea'], []) }, t.token)).body.persona.source).toBe('rule');
    const changed = await runOn(replayApp);
    expect(changed.picks.find((p: Pick) => p.memberId === host)).toMatchObject({ source: 'rule', llmCalls: 0 });
    expect(changed.picks.filter((p: Pick) => p.memberId !== host).every((p: Pick) => p.savedFrom === first.meetingId)).toBe(true);
    // 조건이 바뀌면 지난 결과를 쓰지 않음 (모두 규칙)
    await call(replayApp, 'PUT', `/trips/${t.tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, t.token);
    expect((await runOn(replayApp)).picks.every((p: Pick) => p.source === 'rule' && !p.savedFrom)).toBe(true);
    expect(llm.calls).toBe(calls);
  }, STEP5_TIMEOUT_MS);

  it('녹화·재생: 실제로 부른 답은 녹화되고, 새 여행이라도 같은 요청이면 녹화된 답을 써 LLM 0회 (fill은 없는 요청만 불러 녹화, 다시 쓴 답은 횟수에 세지 않음)', async () => {
    const llm = jangsanLlm();
    const checkpointer = new MemorySaver();
    const runs = { meetingRunsPerTrip: 10 };
    const t = await reviewTrip({ llm, devUi: true, checkpointer, ...runs, llmReplay: 'fill' });
    const tripOf = async (app: App) => {
      const demo = await call(app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
      await call(app, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_night', 'like_sea'], []) }, demo.body.token, { 'cf-connecting-ip': '203.0.113.7' });
      await call(app, 'PUT', `/trips/${demo.body.trip.id}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08' }, demo.body.token);
      return demo.body.token as string;
    };
    const runOn = async (app: App, token: string) => {
      const res = await app.request('/api/v1/dev/meeting/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      return (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.kind === 'result');
    };
    const usage = async () => (await t.db.select().from(llmUsage)).reduce((n, r) => n + r.count, 0);

    // fill: 녹화가 없으니 실제로 부르고 녹화함 (고르기 4 + 이름 맞추기 1)
    const first = await runOn(t.app, t.token);
    expect(first.llmCalls).toBe(4 + 1 + reactCalls(first));
    const recorded = await t.db.select().from(llmRecords);
    // 조건 저장 때의 여행지 확인도 같은 표에 녹화됨 (새 여행이라도 같은 여행지 글이면 LLM 없이 다시 씀)
    expect(recorded.filter((r) => r.purpose !== 'meeting_react').map((r) => r.purpose).sort()).toEqual(['destination', 'meeting_pick', 'meeting_pick', 'meeting_pick', 'meeting_pick', 'place_names']);
    expect(recorded.filter((r) => r.purpose === 'meeting_react').length).toBe(reactCalls(first));
    expect(recorded.every((r) => r.model === 'fake' && r.key.length === 64)).toBe(true);
    const calls = llm.calls;
    const used = await usage();

    // only: 새 여행(같은 성향·조건 → 같은 요청)은 녹화된 답을 그대로 씀. LLM·하루 횟수·회의 횟수 모두 그대로
    const replayApp = createApp({ db: t.db, rateLimitPerMinute: 1000, devUi: true, llm, llmReplay: 'only', checkpointer, ...runs });
    const again = await runOn(replayApp, await tripOf(replayApp));
    expect(again).toMatchObject({ llmCalls: 0, status: 'reviewing' });
    expect(again.picks.every((p: { recorded?: boolean; source: string; llmCalls: number }) => p.recorded === true && p.source === 'llm' && p.llmCalls === 0)).toBe(true);
    const core = (list: { memberId: string; picks: unknown; lodging: unknown; comment: string }[]) => list.map(({ picks, lodging, comment }) => ({ picks, lodging, comment })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(core(again.picks)).toEqual(core(first.picks));
    expect(again.review.items.map((i: { name: string }) => i.name)).toEqual(first.review.items.map((i: { name: string }) => i.name));
    expect(llm.calls).toBe(calls);
    expect(await usage()).toBe(used);

    // fill로 또 새 여행: 녹화가 있으니 부르지 않음
    expect((await runOn(t.app, await tripOf(t.app))).llmCalls).toBe(0);
    expect(llm.calls).toBe(calls);
    expect((await t.db.select().from(llmRecords)).length).toBe(recorded.length);
  }, STEP5_TIMEOUT_MS);

  it('WebSocket: 토큰·여행을 확인하고, 놓친 이벤트를 먼저 보낸 뒤 새 이벤트와 ping을 바로 보냄 (구성원당 연결 수 상한)', async () => {
    const { app, token, tripId } = await reviewTrip({ llm: jangsanLlm(), livePingMs: 40 });
    const id = (await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token)).body.meeting.id as string;
    const waiting = await waitStatus(app, token, id, 'reviewing');
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: liveSocketServer() } }, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    const url = (query: string) => `ws://127.0.0.1:${port}/api/v1/trips/${tripId}/ws?${query}`;
    const opens = (u: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(u);
        ws.onopen = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
      });
    const connect = async (query: string) => {
      const ws = new WebSocket(url(query));
      const got: { type: string; seq?: number; tripId?: string }[] = [];
      let closedWith: number | null = null;
      ws.onmessage = (m) => got.push(JSON.parse(String(m.data)));
      ws.onclose = (e) => {
        closedWith = e.code;
      };
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      return { ws, got, closed: () => closedWith };
    };
    try {
      // 토큰 없음·틀린 토큰·다른 여행 토큰은 연결되지 않음
      expect(await opens(url('afterSeq=0'))).toBe(false);
      expect(await opens(url('token=tok_wrong'))).toBe(false);
      const stranger = await call(app, 'POST', '/trips', { title: '다른 여행', nickname: '손님' });
      expect(await opens(url(`token=${stranger.body.token}`))).toBe(false);
      // WebSocket이 아닌 요청은 400
      expect((await call(app, 'GET', `/trips/${tripId}/ws?token=${token}`)).status).toBe(400);

      // afterSeq=2 뒤부터 받고(놓친 것), 새 이벤트(review.cast)와 ping을 바로 받음
      const a = await connect(`token=${token}&afterSeq=2`);
      await until(() => a.got, (g) => g.some((e) => e.type === 'review.requested'), '놓친 이벤트');
      const replayed = a.got.filter((e) => e.type !== 'ping');
      expect(replayed.map((e) => e.seq)).toEqual(replayed.map((_, i) => i + 3));
      const keepAll = waiting.review.items.map((i: { placeId: string }) => ({ placeId: i.placeId, keep: true }));
      await call(app, 'POST', `/meetings/${id}/review`, { choices: keepAll }, token);
      const cast = await until(() => a.got, (g) => g.some((e) => e.type === 'review.cast'), '새 이벤트');
      expect(cast.find((e) => e.type === 'review.cast')!.seq).toBe(replayed.at(-1)!.seq! + 1);
      await until(() => a.got, (g) => g.some((e) => e.type === 'ping'), 'ping');
      expect(a.got.find((e) => e.type === 'ping')).toMatchObject({ tripId });

      // 같은 구성원이 상한보다 많이 열면 가장 오래된 연결을 닫음
      const more = [];
      for (let i = 0; i < LIVE.perMember; i++) more.push(await connect(`token=${token}&afterSeq=0`));
      await until(() => a.closed(), (code) => code === 4000, '오래된 연결 닫힘');
      expect(more.every((x) => x.closed() === null)).toBe(true);
      for (const x of [a, ...more]) x.ws.close();
    } finally {
      server.close();
    }
  }, STEP5_TIMEOUT_MS);

  it('연결을 여러 번 열고 닫거나 시험 경로 응답을 중간에 끊어도 메모리 항목(구독·구성원 연결·이벤트 줄)이 남지 않음 · 앱이 큰 글을 보내면 닫음(1009) · 보안 헤더', async () => {
    const hub = new EventHub();
    const { app, db, token, tripId } = await reviewTrip({ llm: jangsanLlm(), livePingMs: 40, hub, devUi: true, meetingRunsPerTrip: 100 });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: liveSocketServer() } }, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    const open = () =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/trips/${tripId}/ws?token=${token}&afterSeq=0`);
        ws.onopen = () => resolve(ws);
        ws.onerror = reject;
      });
    const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    const gc = (globalThis as { gc?: () => void }).gc;
    const heap = () => (gc?.(), process.memoryUsage().heapUsed);
    try {
      // 공식 회의 1번(사람 확인에서 멈춤) 뒤 연결 열고 닫기 반복
      const id = (await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token)).body.meeting.id as string;
      await waitStatus(app, token, id, 'reviewing');
      const cycles = Number(process.env.SOAK_CYCLES ?? 40);
      const before = heap();
      for (let i = 0; i < cycles; i++) {
        const ws = await open();
        const done = closed(ws);
        ws.close();
        await done;
      }
      await until(() => hub.entries(), (e) => e.trips === 0 && e.members === 0, '연결 항목 정리');
      const afterWs = heap();

      // 서버는 앱의 글을 받지 않음: 상한보다 큰 글은 연결을 닫음 (메모리에 모으지 않음)
      const big = await open();
      const code = closed(big);
      big.send('x'.repeat(LIVE.maxPayloadBytes * 2));
      expect(await code).toBe(1009);
      await until(() => hub.entries(), (e) => e.trips === 0 && e.members === 0, '큰 글 연결 정리');

      // 시험 경로 응답을 첫 줄만 읽고 끊어도 회의는 끝까지 돌고 이벤트 줄이 남지 않음
      const drops = Number(process.env.SOAK_DROPS ?? 3);
      let last = '';
      for (let i = 0; i < drops; i++) {
        const res = await app.request('/api/v1/dev/meeting/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        const reader = res.body!.getReader();
        last = JSON.parse(new TextDecoder().decode((await reader.read()).value!).split('\n')[0]).meetingId;
        await reader.cancel();
        await until(async () => (await db.select().from(meetings).where(eq(meetings.id, last)))[0].status, (st) => st !== 'running', '끊긴 회의 진행');
      }
      await until(() => pendingEventLanes(), (n) => n === 0, '이벤트 줄 정리');
      expect(hub.entries()).toEqual({ trips: 0, members: 0 });
      if (process.env.SOAK_CYCLES) console.log(`[soak] 연결 ${cycles}회 · 응답 끊기 ${drops}회 · heap ${(before / 1e6).toFixed(1)}MB → 연결 뒤 ${(afterWs / 1e6).toFixed(1)}MB → 끝 ${(heap() / 1e6).toFixed(1)}MB`);

      // 기본 보안 헤더
      const health = await app.request('/api/v1/health');
      expect(health.headers.get('x-content-type-options')).toBe('nosniff');
      expect(health.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    } finally {
      server.close();
    }
  }, 60_000);

  it('회의 시작은 여행 행을 잠근 한 거래에서 함: 공식 경로는 바로 meeting · 시험 경로 다시 실행은 횟수가 남을 때만 이전 확인을 그만둠 · 실패 정리는 다른 회의가 진행 중이면 여행을 되돌리지 않음', async () => {
    const { app, db, token, tripId } = await reviewTrip({ llm: jangsanLlm(), devUi: true, meetingRunsPerTrip: 1 });
    const tripStatus = async () => (await db.select().from(trips).where(eq(trips.id, tripId)))[0].status;
    const id = (await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token)).body.meeting.id as string;
    expect(await tripStatus()).toBe('meeting'); // 202를 돌려주기 전에 이미 바뀜 (회의 행과 같은 거래)
    await waitStatus(app, token, id, 'reviewing');
    // 횟수(1회)를 다 쓴 여행: 시험 경로 다시 실행은 MEETING_LIMIT이고, 사람 확인을 기다리던 회의는 그대로 둠
    const again = await call(app, 'POST', '/dev/meeting/run', undefined, token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('MEETING_LIMIT');
    expect((await db.select().from(meetings).where(eq(meetings.id, id)))[0].status).toBe('reviewing');
    expect(await tripStatus()).toBe('meeting');
    // 방장이 아니면 시험 경로로도 회의를 시작하지 못함
    const guest = await call(app, 'POST', '/trips', { title: '다른 여행', nickname: '손님' });
    const joined = await call(app, 'POST', `/invites/${guest.body.trip.inviteCode}/join`, { nickname: '친구' });
    expect((await call(app, 'POST', '/dev/meeting/run', undefined, joined.body.token)).status).toBe(403);
    // 진행 중인 회의가 있으면 되돌리지 않음 → 끝나면 되돌림
    await reopenTrip(db, tripId);
    expect(await tripStatus()).toBe('meeting');
    await db.update(meetings).set({ status: 'failed' }).where(eq(meetings.id, id));
    await reopenTrip(db, tripId);
    expect(await tripStatus()).toBe('preparing');
  }, STEP5_TIMEOUT_MS);

  it('시험 화면: 1–5단계 실행이 사람 확인에서 멈추고, /dev/meeting/review로 4명 몫을 내면 이어서 끝까지 실행함 (다시 실행하면 이전 확인은 그만둠)', async () => {
    const { app, db, token, people } = await reviewTrip({ llm: jangsanLlm(), devUi: true });
    const ndjsonOf = async (path: string, body?: unknown) => {
      const res = await app.request(`/api/v1${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      return { status: res.status, lines: text.trim().split('\n').map((l) => JSON.parse(l)) };
    };
    const first = (await ndjsonOf('/dev/meeting/run')).lines.find((l) => l.kind === 'result');
    expect(first.status).toBe('reviewing');
    expect(first.review.items.length).toBeGreaterThan(0);
    // 다시 실행: 사람 확인을 기다리던 이전 회의는 실패로 두고 새로 실행
    const second = (await ndjsonOf('/dev/meeting/run')).lines.find((l) => l.kind === 'result');
    expect(second.status).toBe('reviewing');
    const [old] = await db.select().from(meetings).where(eq(meetings.id, first.meetingId));
    expect(old.status).toBe('failed');

    // 방장만 뺌, 나머지 3명은 남김 → 1:3 → 모두 남김
    const responses = people.map((p, i) => ({ memberId: p.id, choices: second.review.items.map((it: { placeId: string }) => ({ placeId: it.placeId, keep: i !== 0 })) }));
    const { status, lines } = await ndjsonOf('/dev/meeting/review', { meetingId: second.meetingId, responses });
    expect(status).toBe(200);
    expect(lines.filter((l) => l.kind === 'event').map((l) => l.event.type)).toEqual(['review.cast', 'review.cast', 'review.cast', 'review.cast', 'review.closed', 'board.updated', 'plan.proposed', 'plan.proposed', 'round.started', ...Array(4).fill(['agent.message', 'vote.cast', 'vote.cast']).flat()]);
    expect(lines.filter((l) => l.kind === 'node').map((l) => l.node)).toEqual(['review', 'schedule', 'evaluate', 'tally']); // 둘 다 통과라 집계에서 끝남
    const end = lines.find((l) => l.kind === 'result');
    expect(end).toMatchObject({ status: 'done', reviewDecision: { closedBy: 'all', dropped: [] } });
  }, STEP5_TIMEOUT_MS);

  it('회의가 끊기거나 그만두게 되면 여행 상태를 준비 중으로 되돌림 (시험 경로 다시 실행 · 서버 재시작 때 실행 중이던 회의)', async () => {
    const { app, db, token, tripId } = await reviewTrip({ llm: jangsanLlm(), devUi: true });
    const tripStatus = async () => (await db.select().from(trips).where(eq(trips.id, tripId)))[0].status;
    const started = await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token);
    const official = started.body.meeting.id as string;
    await waitStatus(app, token, official, 'reviewing');
    expect(await tripStatus()).toBe('meeting');
    // 시험 경로를 다시 실행하면 사람 확인을 기다리던 공식 회의는 그만두고, 여행은 다시 조건·성향을 고칠 수 있음
    const res = await app.request('/api/v1/dev/meeting/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const dev = (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.kind === 'result');
    expect(dev.status).toBe('reviewing');
    expect((await db.select().from(meetings).where(eq(meetings.id, official)))[0].status).toBe('failed');
    expect(await tripStatus()).toBe('preparing');

    // 서버가 켜질 때: 실행 중(running)으로 남은 회의만 실패로 바꾸고 그 여행을 되돌림 (사람 확인을 기다리는 회의는 그대로)
    await db.insert(meetings).values({ id: 'mtg_cut', tripId, runNo: 99, status: 'running' });
    await db.update(trips).set({ status: 'meeting' }).where(eq(trips.id, tripId));
    expect(await failInterruptedMeetings(db)).toBe(1);
    expect((await db.select().from(meetings).where(eq(meetings.id, 'mtg_cut')))[0].status).toBe('failed');
    // 앱이 다시 접속하면 받도록 meeting.failed 이벤트를 남김
    const last = (await eventsAfter(db, tripId, 0)).at(-1)!;
    expect(last).toMatchObject({ type: 'meeting.failed', data: { meetingId: 'mtg_cut', reason: 'error', planId: null } });
    expect((await db.select().from(meetings).where(eq(meetings.id, dev.meetingId)))[0].status).toBe('reviewing');
    expect(await tripStatus()).toBe('preparing');
  }, STEP5_TIMEOUT_MS);
});

describe('LLM_REPLAY 다시 쓰기 검사 (코드, LLM 0회)', () => {
  it('지난 고르기는 고른 곳이 지금 후보(숙소는 숙소 후보)에 모두 있을 때만 다시 씀', () => {
    const pool = { candidates: ['a', 'b', 'c', 'd'].map((id) => ({ id })), lodgings: [{ id: 'h1' }] } as unknown as RetrieveResult;
    const item = (id: string) => ({ id, reason: '좋아요' });
    const saved: PickResult = { memberId: 'm1', source: 'llm', picks: ['a', 'b', 'c'].map(item), lodging: item('h1'), comment: '가요!', llmCalls: 1 };
    expect(savedPickFor(saved, pool)).toBe(saved);
    expect(savedPickFor({ ...saved, picks: ['a', 'b', 'x'].map(item) }, pool)).toBeNull();
    expect(savedPickFor({ ...saved, lodging: item('h9') }, pool)).toBeNull();
    expect(savedPickFor(undefined, pool)).toBeNull();
  });

  it('지난 이름 맞추기는 이름표·낱말이 같은 규칙에만, 지금 장소 목록에 있는 곳만 다시 씀 (ids가 없는 5단계 전 기록은 장소 이름으로 찾음)', async () => {
    const match = savedNameMatcher([
      { label: '엘시티 전망대 가기', keyword: '엘시티 전망대', places: ['부산엑스더스카이'], ids: ['xsky'] },
      { label: '곰장어 먹기', keyword: '곰장어 구이', places: ['자갈치 곰장어'] },
    ]);
    const list = [
      { id: 'xsky', title: '부산엑스더스카이' },
      { id: 'gom', title: '자갈치 곰장어' },
    ] as NamePlace[];
    const rules: NameRule[] = [
      { key: '0', type: 'include', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', target: 'place' },
      { key: '1', type: 'include', label: '곰장어 먹기', keyword: '곰장어 구이', target: 'food' },
      { key: '2', type: 'include', label: '해운대 가기', keyword: '해운대', target: 'place' },
    ];
    expect([...(await match(rules, list))]).toEqual([
      ['0', ['xsky']],
      ['1', ['gom']],
    ]);
    expect([...(await match(rules, list.slice(1)))]).toEqual([['1', ['gom']]]);
  });
});

describe('LLM 녹화·재생 (지문)', () => {
  it('같은 요청·같은 시도 번호만 다시 씀: off면 쓰지 않고, 입력·시도·모델이 다르면 없음, 답 형식이 바뀐 녹화는 버림', async () => {
    const { db } = await createTestApp();
    const schema = z.object({ answer: z.string() });
    const req = { system: '지시', input: { b: 2, a: [1, 2] }, schema, schemaName: 'test_purpose' };
    await llmRecorder(db, 'm1', 'off').record(req, { answer: '가' });
    const only = llmRecorder(db, 'm1', 'only');
    expect(await only.replay({ ...req, input: { a: [1, 2], b: 2 } })).toEqual({ answer: '가' }); // 키 순서는 상관없음
    expect(await only.replay(req, 2)).toBeNull();
    expect(await only.replay({ ...req, input: { a: [2, 1], b: 2 } })).toBeNull();
    expect(await llmRecorder(db, 'm2', 'only').replay(req)).toBeNull();
    expect(await llmRecorder(db, 'm1', 'off').replay(req)).toBeNull();
    expect(await only.replay({ ...req, schema: z.object({ answer: z.number() }) })).toBeNull();
    await only.record(req, { answer: '나' }); // 같은 지문은 덮어쓰지 않음
    expect(await only.replay(req)).toEqual({ answer: '가' });
  });

  it('답 형식이 바뀌어 지금 형식에 맞지 않는 녹화는 같은 지문의 새 답으로 바꿈 (다시 녹화해도 계속 못 쓰는 일이 없게, 10/29)', async () => {
    const { db } = await createTestApp();
    const req = { system: '지시', input: { a: 1 }, schema: z.object({ answer: z.string() }), schemaName: 'test_purpose' };
    await llmRecorder(db, 'm1', 'fill').record(req, { answer: '가' });
    const narrower = { ...req, schema: z.object({ answer: z.enum(['나']) }) };
    const fill = llmRecorder(db, 'm1', 'fill');
    expect(await fill.replay(narrower)).toBeNull();
    await fill.record(narrower, { answer: '나' });
    expect(await fill.replay(narrower)).toEqual({ answer: '나' });
    expect(await db.select().from(llmRecords)).toHaveLength(1);
  });
});

describe('접근 키 (ACCESS_KEYS): 키가 있는 서버는 키를 낸 터널 요청만 실제 API로 회의, 키마다 횟수', () => {
  const KEY = 'team-test-key-0123456789';
  const keyOf = (quota: number) => [{ label: 'team', quota, hash: hashAccessKey(KEY) }];
  const tunnel = { 'cf-connecting-ip': '203.0.113.7' };
  const withKey = { ...tunnel, 'x-access-key': KEY };
  /** 가짜 LLM: 후보 표의 앞 3곳을 고름 (당일 여행이라 숙소 없음) */
  const pickLlm = () =>
    fakeLlm((input) => {
      if (input.areas !== undefined) return areaAnswer(input);
      if (input.rules) return nameAnswer(input);
      if (input.plans) return evalAnswer(input); // 7단계 평가: 모두 찬성
      if (input.places) return { checks: [] };
      const ids = (input.candidates as string).split('\n').slice(1).map((l) => l.split('|')[0]).slice(0, PICK.count);
      return { picks: ids.map((id) => ({ id, reason: '좋아요' })), lodging: { id: '', reason: '' }, comment: '가요!' };
    });
  type T = Awaited<ReturnType<typeof createTestApp>>;
  async function readyTrip(t: T) {
    const demo = await call(t.app, 'POST', '/trips', { title: '부산 시연', nickname: '민수', demoMode: true });
    const token = demo.body.token as string;
    const tripId = demo.body.trip.id as string;
    await call(t.app, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_night', 'like_sea'], []) }, token);
    await call(t.app, 'PUT', `/trips/${tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, token);
    return { token, tripId };
  }
  /** 회의가 뒤에서 끝나거나 사람 확인에서 멈출 때까지 기다림 */
  async function settled(t: T, token: string, id: string) {
    for (let i = 0; i < 300; i++) {
      const m = (await call(t.app, 'GET', `/meetings/${id}`, undefined, token)).body.meeting;
      if (m && m.status !== 'researching') return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('회의가 끝나지 않음');
  }
  const start = (t: T, trip: { token: string; tripId: string }, headers?: Record<string, string>) => call(t.app, 'POST', `/trips/${trip.tripId}/meetings`, undefined, trip.token, headers);

  it('키 없는·틀린 터널 요청은 회의를 시작하지 못하고(403), 키를 내면 202·회의에 키 이름, 키 몫을 다 쓰면 409, 서버 안 요청은 키 없이 됨', async () => {
    const t = await createTestApp({ llm: pickLlm(), accessKeys: keyOf(1) });
    await seedDb(t.db);
    const a = await readyTrip(t);
    for (const headers of [tunnel, { ...tunnel, 'x-access-key': 'wrong-key' }]) {
      const res = await start(t, a, headers);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCESS_KEY_REQUIRED');
    }
    expect(await t.db.select().from(meetings)).toHaveLength(0);
    const ok = await start(t, a, withKey);
    expect(ok.status).toBe(202);
    await settled(t, a.token, ok.body.meeting.id);
    // 다른 여행이어도 같은 키의 몫(1회)을 다 씀
    const b = await readyTrip(t);
    const over = await start(t, b, withKey);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('ACCESS_QUOTA_EXCEEDED');
    const local = await start(t, b);
    expect(local.status).toBe(202);
    await settled(t, b.token, local.body.meeting.id);
    const rows = await t.db.select({ trip: meetings.tripId, label: meetings.accessLabel }).from(meetings);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([{ trip: a.tripId, label: 'team' }, { trip: b.tripId, label: null }]));
  });

  it('LLM_REPLAY=true여도 키로 시작한 회의만 LLM을 부르고(키 그래프), 서버 안에서 시작한 회의는 LLM 0회', async () => {
    const llm = pickLlm();
    const t = await createTestApp({ llm, llmReplay: true, accessKeys: keyOf(5) });
    await seedDb(t.db);
    const a = await readyTrip(t);
    const local = await start(t, a);
    expect(local.status).toBe(202);
    await settled(t, a.token, local.body.meeting.id);
    expect(llm.calls).toBe(0);
    const b = await readyTrip(t);
    const keyed = await start(t, b, withKey);
    expect(keyed.status).toBe(202);
    await settled(t, b.token, keyed.body.meeting.id);
    expect(llm.calls).toBeGreaterThan(0);
  });

  it('시험 경로: 키가 있는 서버의 터널 요청은 키(헤더·쿠키)가 있어야 하고, 시험 화면은 /dev/key로 보냄. 맞는 키를 넣으면 HttpOnly·Secure 쿠키', async () => {
    const { app } = await createTestApp({ devUi: true, devUiTunnel: true, accessKeys: keyOf(1) });
    const graph = (headers: Record<string, string>) => call(app, 'GET', '/dev/meeting/graph', undefined, undefined, headers);
    expect((await graph(tunnel)).body.error.code).toBe('ACCESS_KEY_REQUIRED');
    expect((await graph(withKey)).status).toBe(200);
    expect((await graph({ ...tunnel, Cookie: `journey_key=${KEY}` })).status).toBe(200);
    expect((await graph({})).status).toBe(200);
    const page = await app.request('/dev/meeting', { headers: tunnel });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/dev/key');
    expect((await app.request('/dev/meeting', { headers: { ...tunnel, Cookie: `journey_key=${KEY}` } })).status).toBe(200);
    const post = (key: string) =>
      app.request('/dev/key', { method: 'POST', headers: { ...tunnel, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key }).toString() });
    expect((await post('wrong-key')).status).toBe(403);
    const ok = await post(KEY);
    expect(ok.status).toBe(302);
    const cookie = ok.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('journey_key=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it('ACCESS_KEYS 형식: 이름:횟수:sha256를 쉼표로 이음, 틀리면 서버를 켜지 않고 오류 문구에 키 값을 넣지 않음', () => {
    const h = hashAccessKey(KEY);
    expect(parseAccessKeys(` team:100:${h} , demo:5:${h.toUpperCase()}`)).toEqual([
      { label: 'team', quota: 100, hash: h },
      { label: 'demo', quota: 5, hash: h },
    ]);
    expect(parseAccessKeys('')).toEqual([]);
    expect(() => parseAccessKeys(`team:100:${KEY}`)).toThrow(/ACCESS_KEYS 형식/);
    expect(() => parseAccessKeys(`team:100:${KEY}`)).not.toThrow(new RegExp(KEY));
  });
});

describe('매일 정리 · 체크포인트 연결 풀', () => {
  it('끝난 회의 기록은 기록이 남은 회의만 지움 (이미 지운 회의를 매일 다시 지우지 않음) · 보관 날 수가 지난 길찾기는 지움', async () => {
    const t = await createTestApp();
    const host = await call(t.app, 'POST', '/trips', { title: '부산', nickname: '민수' });
    const tripId = host.body.trip.id as string;
    const old = new Date(Date.now() - 40 * 86400000);
    await t.db.insert(meetings).values([
      { id: 'mtg_old_kept', tripId, runNo: 1, status: 'done', finishedAt: old },
      { id: 'mtg_old_gone', tripId, runNo: 2, status: 'failed', finishedAt: old },
      { id: 'mtg_recent', tripId, runNo: 3, status: 'done', finishedAt: new Date() },
    ]);
    // 체크포인트 표 흉내: 기록이 남은 회의는 mtg_old_kept·mtg_recent뿐 (mtg_old_gone은 이미 지움)
    await t.db.execute(sql`create schema lg_test`);
    await t.db.execute(sql`create table lg_test.checkpoints (thread_id text not null)`);
    await t.db.execute(sql`insert into lg_test.checkpoints values ('mtg_old_kept'), ('mtg_recent')`);
    const deleted: string[] = [];
    const saver = { deleteThread: async (id: string) => void deleted.push(id) } as unknown as BaseCheckpointSaver;
    expect(await pruneMeetingCheckpoints(t.db, saver, 30, 'lg_test')).toBe(1);
    expect(deleted).toEqual(['mtg_old_kept']);

    const now = new Date();
    await t.db.insert(routeCache).values([
      { key: 'car|old', mode: 'car', result: null, fetchedAt: new Date(now.getTime() - 8 * 86400000) },
      { key: 'car|new', mode: 'car', result: null, fetchedAt: new Date(now.getTime() - 86400000) },
    ]);
    expect(await pruneRouteCache(t.db, now)).toBe(1);
    expect((await t.db.select().from(routeCache)).map((r) => r.key)).toEqual(['car|new']);
  });

  it('체크포인트 연결 풀은 쉬던 연결이 끊긴 오류(error)를 받아 서버가 꺼지지 않음', async () => {
    const pool = checkpointPool('postgres://journey@127.0.0.1:1/journey', 1);
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    } finally {
      console.warn = warn;
      await pool.end();
    }
  });
});
