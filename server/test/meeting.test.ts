import { describe, expect, it } from 'vitest';
import { categories, crowdFetches, placeRelations, places, regions, relatedFetches } from '../src/db/schema.js';
import { ruleCategories } from '../src/meeting/categories.js';
import { closedOn, hoursOn } from '../src/meeting/hours.js';
import { resolveDestination } from '../src/meeting/regions.js';
import { type MemberInput, retrieveCandidates } from '../src/meeting/retrieve.js';
import { ruleMatcher, sameName } from '../src/meeting/rules.js';
import type { PersonaProfile } from '../src/persona/types.js';
import type { TourClient } from '../src/tour/client.js';
import { meetings } from '../src/db/schema.js';
import { PICK } from '../src/meeting/pick.js';
import { MINSU, answersOf, call, createTestApp, fakeLlm } from './helpers.js';

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

  it('여행 날짜가 30일 밖이면 집중률을 부르지 않고 null로 둠', async () => {
    const { db } = await createTestApp();
    await seedDb(db);
    const crowd = fakeCrowd();
    const r = await retrieveCandidates(db, { conditions: CONDITIONS, destination: DEST, members: MEMBERS, crowdClient: crowd.client, today: '2026-09-01' });
    expect(crowd.calls).toEqual([]);
    expect(r.crowd.note).toBe('out_of_window');
    expect(r.candidates.every((c) => c.crowd === null)).toBe(true);
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
    expect(graph.body.nodes.map((n: { id: string }) => n.id)).toEqual(['__start__', 'prepare', 'retrieve', 'pick', 'gather', '__end__']);
    expect(graph.body.edges).toContainEqual({ from: 'prepare', to: 'retrieve', conditional: false });
    expect((await call(app, 'GET', '/dev/meeting/graph', undefined, undefined, { 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403);
  });
});

describe('3단계 고르기 ×4 (시험 경로 /dev/meeting/run)', () => {
  /** 가짜 LLM: 후보 표의 앞쪽 id를 고름. bad(member 제목, 몇 번째 호출)가 true면 표에 없는 id를 냄 */
  const pickLlm = (bad: (title: string, n: number) => boolean = () => false, ignoreMust: (title: string, n: number) => boolean = () => false) => {
    const seen = new Map<string, number>();
    return fakeLlm((input) => {
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
    expect(result.llmCalls).toBe(4);
    expect(llm.calls).toBe(4);
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
    const stages = events.filter((e) => e.type === 'research.progress').map((e) => e.data.stage);
    for (const stage of ['planning', 'done']) expect(stages.filter((x) => x === stage)).toHaveLength(4);
    expect(stages.filter((x) => x === 'searching').length).toBeGreaterThanOrEqual(8); // 사람마다 장소 찾기·인기 순위(+혼잡도)
    expect(stages.filter((x) => x === 'picking').length).toBe(4 + 4 * (PICK.count + 1)); // 고르기 시작 + 고른 곳·숙소마다
    expect(events.filter((e) => e.type === 'agent.message')).toHaveLength(4);
    const done = events.find((e) => e.type === 'research.progress' && e.data.stage === 'done');
    expect(done.data.focus).toMatchObject({ label: expect.any(String) });

    // 시험 화면용 LLM 과정(요청·받는 글자·응답)은 화면으로만 보내고 DB에는 기록하지 않음
    const traces = lines.filter((l) => l.kind === 'llm');
    expect(traces.filter((l) => l.type === 'llm.request')).toHaveLength(4);
    expect(traces.filter((l) => l.type === 'llm.response')).toHaveLength(4);
    const first = traces.find((l) => l.type === 'llm.request').data.agentId;
    const typed = traces.filter((l) => l.type === 'llm.delta' && l.data.agentId === first).map((l) => l.data.text).join('');
    expect(JSON.parse(typed).picks).toHaveLength(PICK.count);
    expect(traces.find((l) => l.type === 'llm.request').data.input.candidates.split('\n')[0]).toBe('번호|이름|분류|인기|혼잡|요약'); // 고르기에 필요한 칸만, id 대신 짧은 번호

    // 다시 접속한 화면은 afterSeq 뒤부터 받음
    const again = await call(app, 'GET', '/dev/meeting/events?afterSeq=2', undefined, token);
    expect(again.body.events[0].seq).toBe(3);
    expect(again.body.events).toHaveLength(events.length - 2);
    expect(again.body.events.some((e: { type: string }) => e.type.startsWith('llm.'))).toBe(false);
    const [row] = await db.select().from(meetings);
    expect(row).toMatchObject({ status: 'done', llmCalls: 4, runNo: 1 });
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
    expect(result.llmCalls).toBe(PICK.tries + 2 + 1 + 1);
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

