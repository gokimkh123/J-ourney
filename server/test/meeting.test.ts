import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { MemorySaver } from '@langchain/langgraph';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { llmRecorder } from '../src/llm/record.js';
import { WebSocketServer } from 'ws';
import { createApp } from '../src/app.js';
import { categories, crowdFetches, llmRecords, llmUsage, members, placeRelations, places, regions, relatedFetches } from '../src/db/schema.js';
import { hashToken } from '../src/lib/ids.js';
import { REVIEW, applyReview, reviewRequestOf, tallyReview } from '../src/meeting/review.js';
import { ruleCategories } from '../src/meeting/categories.js';
import { closedOn, hoursOn } from '../src/meeting/hours.js';
import { resolveDestination } from '../src/meeting/regions.js';
import { type NameMatcher, type NamePlace, type NameRule, decodeNames, nameInput, nameMatcher, savedNameMatcher } from '../src/meeting/names.js';
import { type MemberInput, RETRIEVE, retrieveCandidates } from '../src/meeting/retrieve.js';
import { ruleMatcher, sameName } from '../src/meeting/rules.js';
import type { PersonaProfile } from '../src/persona/types.js';
import type { TourClient } from '../src/tour/client.js';
import { meetings } from '../src/db/schema.js';
import { LIVE } from '../src/meeting/live.js';
import { PICK, type PickResult, ensureOwnLimits, ownConflictIds, pickTables, savedPickFor } from '../src/meeting/pick.js';
import { REACT, overlapMinutes, reactBoard, reactionOf, reactionScore } from '../src/meeting/react.js';
import { acceptReactions, reactRequest, reactWishes } from '../src/meeting/react-ai.js';
import type { Candidate, RetrieveResult } from '../src/meeting/retrieve.js';
import { MINSU, answersOf, call, createTestApp, fakeLlm } from './helpers.js';

/** 4단계 AI 반응 호출 수: 다른 AI가 고른 곳이 보드에 하나라도 있는 사람마다 1회 (시험의 4명은 모두 바람 글이 있음) */
const reactCalls = (r: { members: { memberId: string }[]; board: { candidates: { proposedBy: string[] }[] } }) =>
  r.members.filter((m) => r.board.candidates.some((c) => !c.proposedBy.includes(`agt_${m.memberId.replace(/^mem_/, '')}`))).length;

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
  const ctx = { regionWords: ['부산'], districtsOf: (w: string) => (w === '해운대' ? ['350'] : []) };
  const place = (title: string, extra: Partial<{ code: string; districtCode: string; isFood: boolean; menu: string }> = {}) => ({
    title,
    code: extra.code ?? null,
    districtCode: extra.districtCode ?? null,
    isFood: extra.isFood ?? false,
    menu: extra.menu ?? null,
  });

  it('특정 장소는 이름이 통째로 같을 때만 (지점명·지역 이름은 떼고 봄)', () => {
    expect(sameName('이재모피자', '이재모피자 본점')).toBe(true);
    expect(sameName('블루라인파크', '해운대 블루라인파크')).toBe(true);
    expect(sameName('감천문화마을', '부산 감천문화마을', ['부산'])).toBe(true);
    expect(sameName('오사카', '오사카라멘 서면점')).toBe(false);
    expect(sameName('온천', '온천천시민공원')).toBe(false);
    expect(sameName('회', '회')).toBe(false); // 한 글자는 이름으로 찾지 않음
  });

  it('target마다 정해진 칸만 봄', () => {
    const spa = ruleMatcher(rule('include', '온천', '온천', 'category', ['EX050100']), ctx);
    expect(spa(place('해운대온천센터', { code: 'EX050100' }))).toBe(true);
    expect(spa(place('온천천시민공원', { code: 'VE030100' }))).toBe(false);
    const food = ruleMatcher(rule('avoid', '회', '회 빼기', 'food'), ctx);
    expect(food(place('민락회센터', { isFood: true, menu: '모듬회' }))).toBe(true);
    expect(food(place('부산시민회관'))).toBe(false); // 음식점이 아니고 한 글자라 이름으로 찾지 않음
    const area = ruleMatcher(rule('include', '해운대', '해운대 가기', 'area'), ctx);
    expect(area(place('장산', { districtCode: '350' }))).toBe(true);
    expect(area(place('광안리해수욕장', { districtCode: '500' }))).toBe(false);
    const abroad = ruleMatcher(rule('include', '오사카', '오사카 가기', 'place'), ctx);
    expect(abroad(place('오사카라멘 서면점', { isFood: true }))).toBe(false);
  });
});

describe('목적지 → 법정동 코드', () => {
  it('시·도, 시·도 + 구, 구 이름, 줄인 이름을 읽고 여러 곳이면 오류', async () => {
    const { db } = await createTestApp();
    await db.insert(regions).values(REGIONS);
    expect(await resolveDestination(db, '부산')).toMatchObject({ regionCode: '26', districtCodes: [] });
    expect(await resolveDestination(db, '부산 해운대구')).toMatchObject({ regionCode: '26', districtCodes: ['350'] });
    expect(await resolveDestination(db, '해운대')).toMatchObject({ regionCode: '26', districtCodes: ['350'] });
    // '광주'는 전남광주통합특별시이기도 하고 경기도 광주시이기도 해서 고르게 함
    await expect(resolveDestination(db, '광주')).rejects.toThrow(/여러 곳에 있음 '광주'.*경기도 광주시/);
    expect(await resolveDestination(db, '전남광주')).toMatchObject({ regionCode: '12', districtCodes: [] });
    expect(await resolveDestination(db, '경기 광주')).toMatchObject({ regionCode: '41', districtCodes: ['610'] });
    expect(await resolveDestination(db, '광주 동구')).toMatchObject({ regionCode: '12', districtCodes: ['110'] });
    expect(await resolveDestination(db, '경남')).toMatchObject({ regionCode: '48' });
    await expect(resolveDestination(db, '중구')).rejects.toThrow(/여러 곳/);
    await expect(resolveDestination(db, '없는마을')).rejects.toThrow(/찾지 못함/);
  });
});

describe('후보 찾기 (2단계, 코드)', () => {
  it('축제 날짜·휴무일·꼭 피할 것을 거르고, 같은 곳은 하나만 남기고, 사람별 점수를 매김', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const crowd = fakeCrowd();
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, today: '2026-11-01' });
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
    expect(by['신창국밥 본점'].reasons.m3).toEqual(['좋아요: 맛집', '꼭 지킬 것: 돼지국밥 먹기']); // 메뉴로 맞춤
    expect(by['수변최고돼지국밥'].reasons.m3).toContain('꼭 지킬 것: 돼지국밥 먹기'); // 음식점 이름으로 맞춤
    // '온천'은 공식 분류가 '온천 / 사우나 / 스파'인 곳만: 이름에 온천이 있는 카페·식당·공원, 메뉴에 '스파게티'가 있는 식당은 아님
    for (const n of ['온천천 카페', '이재모피자', '온천입구곰장어', '온천천시민공원']) {
      expect(by[n].reasons.m4.some((w) => w.startsWith('꼭 지킬 것'))).toBe(false);
      expect(by[n].reasons.m4.some((w) => w.includes('온천·스파'))).toBe(false);
    }
    expect(by['온천천 카페'].category).toBe('카페');
    expect(by['장산'].reasons.m4).toContain('싫어요: 오래 걷기'); // 산 분류
    expect(by['광안리해수욕장'].reasons.m1).toContain('좋아요: 바다'); // 해변 분류
    expect(r.table.split('\n')[0]).toBe('id|이름|분류|인기|혼잡|영업|요약');
    expect(r.table.split('\n')).toHaveLength(r.candidates.length + 1);
    expect(r.sources).toEqual(['tour_api', 'tour_rank', 'tour_crowd']);
    expect(r.popularity.baseYm).toBe('202511');

    // 같은 날 다시 하면 집중률은 받아 둔 것을 씀 (API 호출 없음)
    const before = crowd.calls.length;
    const again = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, today: '2026-11-01' });
    expect(crowd.calls.length).toBe(before);
    expect(again.crowd.fetched).toEqual([]);
    expect(again.crowd.cached).toContain('26500');
    expect((await db.select().from(crowdFetches)).length).toBe(REGIONS.filter((x) => x.regionCode === '26').length);

    // 동시에 같은 지역을 찾아도 구·군마다 한 번만 부름 (먼저 시작한 호출을 함께 기다림)
    const twin = fakeCrowd();
    await Promise.all([1, 2].map(() => retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: twin.client, today: '2026-11-02' })));
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
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01' });
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
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [marketGoer], crowdClient: null, today: '2026-11-01' });
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
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [shopper], crowdClient: null, today: '2026-11-01' });
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
    const day = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: null, today: '2026-11-01' });
    expect(day).toMatchObject({ nights: 0, lodgings: [], lodgingTable: '' });
    expect(day.candidates.some((c) => c.type === 32)).toBe(false);

    const twoDays = { ...CONDITIONS, endDate: '2026-11-08' };
    const noHostel: MemberInput = { ...MEMBERS[3], mustKeep: [...MEMBERS[3].mustKeep, rule('avoid', '게스트하우스', '게스트하우스 빼기', 'category', ['AC0602'])] };
    const r = await retrieveCandidates(db, { conditions: twoDays, destination: DEST, members: [...MEMBERS.slice(0, 3), noHostel], crowdClient: null, today: '2026-11-01' });
    expect(r.nights).toBe(1);
    expect(r.lodgings.map((c) => c.name)).toEqual(['광안호텔']);
    expect(r.candidates.some((c) => c.type === 32)).toBe(false); // 40곳에는 넣지 않음
    expect(r.lodgingTable.split('\n')[1]).toContain('광안호텔|호텔');
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
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: seaLovers, crowdClient: null, today: '2026-11-01' });
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
      return new Map([[rules.find((r) => r.keyword === '엘시티 전망대')!.key, ['xsky', '목록에없는id']]]);
    };
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01', matchNames });
    expect(asked).toHaveLength(1); // 맞추지 못한 규칙을 한 번에 보냄
    expect(asked[0].map((x) => x.keyword)).toEqual(['엘시티 전망대', '없는곳']);
    expect(r.candidates.find((c) => c.name === '부산엑스더스카이')?.marks.m7).toContainEqual({ kind: 'must', label: '엘시티 전망대 가기' });
    expect(r.nameMatches).toEqual([{ memberId: 'm7', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', places: ['부산엑스더스카이'], ids: ['xsky'] }]); // 목록에 없는 id는 버림
    expect(r.missingRules).toEqual([{ memberId: 'm7', label: '없는곳 가기', reason: '여행지 자료에서 찾지 못함' }]);
    // 4단계 안건에 메모로 보임
    const board = reactBoard({ candidates: [], agenda: [] }, r, [fan]);
    expect(board.agenda.map((a) => a.text)).toContain(`${fan.nickname}의 꼭 지킬 것 '없는곳 가기' — 여행지 자료에서 찾지 못함`);
    expect(board.agenda.map((a) => a.text)).toContain(`${fan.nickname}의 꼭 지킬 것 '엘시티 전망대' → 부산엑스더스카이 (이름이 달라 AI가 맞춤)`);
    // 맞춘 곳이 보드에 오르면 메모 대신 장소 안건 (5단계에서 사람이 맞는 곳인지 남김·뺌으로 확인)
    const picked = reactBoard({ candidates: [{ placeId: 'plc_xsky', name: '부산엑스더스카이', lat: null, lng: null, proposedBy: ['agt_m7'], reactions: [] }], agenda: [] }, r, [fan]);
    expect(picked.agenda.filter((a) => a.placeId !== null)).toEqual([{ placeId: 'plc_xsky', text: `부산엑스더스카이 — ${fan.nickname} 고름 · 이름이 달라 AI가 맞춘 ${fan.nickname}의 꼭 지킬 곳 ('엘시티 전망대')` }]);
    expect(picked.agenda.map((a) => a.text).some((x) => x.includes('→ 부산엑스더스카이'))).toBe(false);
    // 이름 맞추기가 없으면(LLM 없음·상한) 맞추지 않고 둘 다 메모로 남김
    const plain = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01' });
    expect(plain.nameMatches).toEqual([]);
    expect(plain.missingRules.map((x) => x.label)).toEqual(['엘시티 전망대 가기', '없는곳 가기']);
    // 코드가 이름으로 찾은 규칙은 묻지 않음 (LLM 0회)
    const found: MemberInput = { ...MEMBERS[1], memberId: 'm8', mustKeep: [rule('include', '태종대온천찜질방', '찜질방 가기', 'place')] };
    let calls = 0;
    const counting: NameMatcher = async () => {
      calls++;
      return new Map();
    };
    await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [found], crowdClient: null, today: '2026-11-01', matchNames: counting });
    expect(calls).toBe(0);
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
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [fan], crowdClient: null, today: '2026-11-01' });
    expect(r.candidates.some((c) => c.outside)).toBe(false);
    expect(r.outsideRules).toHaveLength(1);
    expect(r.outsideRules[0].placeId).toBeNull();
    expect(r.outsideRules[0].minutes).toBeGreaterThan(RETRIEVE.outsideMaxMinutes);
  });

  it('여행 날짜가 30일 밖이면 집중률을 부르지 않고 null로 둠', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const crowd = fakeCrowd();
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, today: '2026-09-01' });
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
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [fan], crowdClient: null, today: '2026-11-01' });
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
    const blocked = await retrieveCandidates(db, { conditions: CONDITIONS, destination: suyeong, members: [fan, spaHater], crowdClient: null, today: '2026-11-01' });
    expect(blocked.candidates.some((c) => c.outside)).toBe(false);
    expect(blocked.outsideRules.map((x) => x.placeId)).toEqual([null]);
    // 시·도 전체 여행이면 여행지 밖이 없음
    const whole = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: [fan], crowdClient: null, today: '2026-11-01' });
    expect(whole.outsideRules).toEqual([]);
    expect(whole.candidates.some((c) => c.outside)).toBe(false);
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
    expect(graph.body.nodes.map((n: { id: string }) => n.id)).toEqual(['__start__', 'prepare', 'retrieve', 'pick', 'gather', 'react', 'review', '__end__']);
    expect(graph.body.edges).toContainEqual({ from: 'react', to: 'review', conditional: true }); // 고를 안건이 있을 때만 사람 확인
    expect(graph.body.nodes.find((n: { id: string }) => n.id === 'review')).toMatchObject({ step: 5, kind: 'human' });
    expect(graph.body.edges).toContainEqual({ from: 'prepare', to: 'retrieve', conditional: false });
    expect(graph.body.edges).toContainEqual({ from: 'gather', to: 'react', conditional: false });
    expect((await call(app, 'GET', '/dev/meeting/graph', undefined, undefined, { 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403);
  });

  it('DEV_UI_TUNNEL을 켜면 터널 요청도 시험 경로를 씀 (팀원 확인용)', async () => {
    const { app } = await createTestApp({ devUi: true, devUiTunnel: true });
    const graph = await call(app, 'GET', '/dev/meeting/graph', undefined, undefined, { 'cf-connecting-ip': '203.0.113.7' });
    expect(graph.status).toBe(200);
    expect(graph.body.nodes.length).toBeGreaterThan(0);
  });
});

describe('3단계 고르기 ×4 (시험 경로 /dev/meeting/run)', () => {
  /** 가짜 LLM: 후보 표의 앞쪽 id를 고름. bad(member 제목, 몇 번째 호출)가 true면 표에 없는 id를 냄 */
  const pickLlm = (bad: (title: string, n: number) => boolean = () => false, ignoreMust: (title: string, n: number) => boolean = () => false) => {
    const seen = new Map<string, number>();
    return fakeLlm((input) => {
      // 2단계 이름 맞추기 요청: 시연 여행 지은의 '흰여울문화마을'은 시험 자료에 없어 1번 불리고, 맞는 곳이 없다고 답함
      if (input.rules) return { matches: [] };
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

  it('4명이 각자 3곳 + 숙소를 고르고, 명세서 이벤트를 순서대로 기록·전송함 (LLM 4회)', async () => {
    const llm = pickLlm();
    const { app, db, token } = await readyTrip({ llm });
    const { status, lines } = await run(app, token);
    expect(status).toBe(200);
    const result = lines.find((l) => l.kind === 'result');
    expect(result.llmCalls).toBe(4 + 1); // 고르기 4 + 이름 맞추기 1 (흰여울문화마을이 시험 자료에 없음)
    expect(llm.calls).toBe(4 + 1);
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
    expect(events.at(-1).type).toBe('board.updated');
    // 고를 안건(장소 안건)이 없는 보드라 5단계에서 멈추지 않고 끝남
    expect(events.at(-1).data.agenda.some((a: { placeId: string | null }) => a.placeId !== null)).toBe(false);
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
    const stages = events.filter((e) => e.type === 'research.progress').map((e) => e.data.stage);
    for (const stage of ['planning', 'done']) expect(stages.filter((x) => x === stage)).toHaveLength(4);
    expect(stages.filter((x) => x === 'searching').length).toBeGreaterThanOrEqual(8); // 사람마다 장소 찾기·인기 순위(+혼잡도)
    expect(stages.filter((x) => x === 'picking').length).toBe(4 + 4 * (PICK.count + 1)); // 고르기 시작 + 고른 곳·숙소마다
    expect(events.filter((e) => e.type === 'agent.message')).toHaveLength(4);
    const done = events.find((e) => e.type === 'research.progress' && e.data.stage === 'done');
    expect(done.data.focus).toMatchObject({ label: expect.any(String) });

    // 시험 화면용 LLM 과정(요청·받는 글자·응답)은 화면으로만 보내고 DB에는 기록하지 않음
    // 2단계 이름 맞추기 1회는 agentId 없이 purpose 'names'로 보냄 (고르기 4회와 구분)
    const names = lines.filter((l) => l.kind === 'llm' && l.data.purpose === 'names');
    expect(names.map((l) => l.type)).toEqual(['llm.request', 'llm.response']);
    expect(names[0].data.input.rules).toEqual(['1|장소|흰여울문화마을']);
    const traces = lines.filter((l) => l.kind === 'llm' && l.data.purpose !== 'names');
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
    expect(row).toMatchObject({ status: 'done', llmCalls: 4 + 1, runNo: 1 });
  });

  it('4단계 AI 반응: 사람마다 LLM 1회로 다른 AI가 고른 곳에 반응하고, 근거가 있는 ⚠는 안건이 되어 5단계에서 멈춤 (근거를 지어낸 반응은 버림)', async () => {
    const llm = fakeLlm((input) => {
      if (input.rules) return { matches: [] };
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
    expect(result.llmCalls).toBe(1 + 4 + result.picks.filter((p: { llmCalls: number }) => p.llmCalls === 2).length + reactCalls(result));
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
    expect(result.llmCalls).toBe(1 + PICK.tries + 2 + 1 + 1 + reactCalls(result)); // 이름 맞추기 1 + 고르기 + 4단계 AI 반응
    const rulePick = byTitle['반짝반짝 탐험가'];
    const mine = result.retrieve.candidates.filter((c: { forMembers: string[] }) => c.forMembers.includes(rulePick.memberId));
    expect(rulePick.picks.every((x: { id: string }) => mine.some((c: { id: string }) => c.id === x.id))).toBe(true);
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
    expect(llm.calls).toBe(1); // 고르기는 0회, 이름 맞추기 1회뿐 (흰여울문화마을이 시험 자료에 없음)
    expect(result.llmCalls).toBe(1);
    expect(result.picks.every((p: { source: string; picks: unknown[] }) => p.source === 'rule' && p.picks.length === result.retrieve.candidates.length)).toBe(true);
  });

  it('하루 LLM 상한이면 부르지 않고 4명 모두 규칙 고르기, 실행 횟수는 여행당 상한까지', async () => {
    const llm = pickLlm();
    const { app, db, token } = await readyTrip({ llm, llmDailyLimit: 0, meetingRunsPerTrip: 2 });
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
    const mustPool = { ...pool, candidates: [{ ...crowded, reasons: { m4: ['꼭 지킬 것: 계곡 가기'] } }, sea, food, quiet] } as unknown as RetrieveResult;
    expect(ownConflictIds(seoyeon, mustPool).size).toBe(0);
    expect(ensureOwnLimits(picked, seoyeon, mustPool).picks.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('이름 맞추기 (2단계, LLM 1회)', () => {
  const rules: NameRule[] = [
    { key: 'a', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', target: 'place' },
    { key: 'b', label: '곰장어 먹기', keyword: '곰장어 구이', target: 'food' },
  ];
  const list: NamePlace[] = [
    { id: 'x', title: '부산엑스더스카이', category: '타워/전망대', district: '해운대구', isFood: false, menu: null, summary: '해운대 엘시티 100층 전망대', popularity: 90 },
    { id: 'y', title: '자갈치꼼장어', category: '관광식당', district: '중구', isFood: true, menu: '꼼장어구이, 장어탕', summary: null, popularity: null },
    { id: 'z', title: '해운대 전망 카페', category: '카페', district: '해운대구', isFood: true, menu: '커피', summary: null, popularity: null },
  ];

  it('후보는 글자 겹침·인기 순으로 줄여 짧은 번호로 보내고, 답의 번호를 id로 되돌림 (없는 번호·없는 규칙은 버림)', () => {
    const { codes, input } = nameInput(rules, list);
    expect(input.rules).toEqual(['1|장소|엘시티 전망대', '2|음식|곰장어 구이']);
    expect(input.places).toContain('부산엑스더스카이'); // 이름이 전혀 달라도 인기 상위라 들어감
    expect(input.places).toContain('메뉴: 꼼장어구이'); // 음식은 메뉴 글자 겹침
    const codeOf = (id: string) => [...codes].find(([, v]) => v === id)![0];
    const back = decodeNames(
      { matches: [{ rule: 1, why: '소개에 엘시티 전망대', sure: true, places: [codeOf('x'), 'P99'] }, { rule: 9, why: '-', sure: true, places: [codeOf('y')] }, { rule: 2, why: '모름', sure: false, places: [codeOf('y')] }] },
      rules,
      codes,
    );
    expect(back.get('a')).toEqual(['x']);
    expect(back.has('b')).toBe(false); // sure가 false면 골랐어도 받지 않음
    expect(input.places).toContain('엘시티'); // 소개 조각: 규칙 글자가 나오는 곳 둘레
  });

  it('맞출 규칙이 있을 때 LLM을 1번만 부르고, 상한이면 부르지 않으며, 실패하면 빈 결과', async () => {
    const llm = fakeLlm(() => ({ matches: [{ rule: 1, why: '같은 곳', sure: true, places: ['P1'] }] }));
    const out = await nameMatcher(llm, async () => true)(rules, list);
    expect(llm.calls).toBe(1);
    expect([...out.keys()]).toEqual(['a']);
    const blocked = fakeLlm(() => ({ matches: [] }));
    expect((await nameMatcher(blocked, async () => false)(rules, list)).size).toBe(0);
    expect(blocked.calls).toBe(0);
    const broken = fakeLlm(() => {
      throw new Error('boom');
    });
    expect((await nameMatcher(broken, async () => true)(rules, list)).size).toBe(0);
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
      if (input.rules) return { matches: [] }; // 2단계 이름 맞추기 (흰여울문화마을은 시험 자료에 없음)
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
    expect(done.llmCalls).toBe(waiting.llmCalls); // 5단계는 LLM 0회

    // 이벤트: review.requested → review.cast ×4(덮어쓰기 포함) → review.closed → board.updated(장산 빠짐), seq는 이어짐
    const { events } = (await call(app, 'GET', `/trips/${tripId}/events?afterSeq=0`, undefined, token)).body;
    expect(events.map((e: { seq: number }) => e.seq)).toEqual(events.map((_: unknown, i: number) => i + 1));
    const tail = events.slice(events.findIndex((e: { type: string }) => e.type === 'review.requested'));
    expect(tail.map((e: { type: string }) => e.type)).toEqual(['review.requested', 'review.cast', 'review.cast', 'review.cast', 'review.cast', 'review.closed', 'board.updated']);
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
    expect(recorded.filter((r) => r.purpose !== 'meeting_react').map((r) => r.purpose).sort()).toEqual(['meeting_pick', 'meeting_pick', 'meeting_pick', 'meeting_pick', 'place_names']);
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
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: new WebSocketServer({ noServer: true }) } }, () => resolve(s));
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
    expect(lines.filter((l) => l.kind === 'event').map((l) => l.event.type)).toEqual(['review.cast', 'review.cast', 'review.cast', 'review.cast', 'review.closed', 'board.updated']);
    expect(lines.filter((l) => l.kind === 'node').map((l) => l.node)).toEqual(['review']);
    const end = lines.find((l) => l.kind === 'result');
    expect(end).toMatchObject({ status: 'done', reviewDecision: { closedBy: 'all', dropped: [] } });
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
      { key: '0', label: '엘시티 전망대 가기', keyword: '엘시티 전망대', target: 'place' },
      { key: '1', label: '곰장어 먹기', keyword: '곰장어 구이', target: 'food' },
      { key: '2', label: '해운대 가기', keyword: '해운대', target: 'place' },
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
});
