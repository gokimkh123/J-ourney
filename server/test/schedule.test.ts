import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { categories, places, regions, routeCache } from '../src/db/schema.js';
import type { MemberInput, Candidate, RetrieveResult } from '../src/meeting/retrieve.js';
import { ROUTE, type RouteClient, RouteUnavailable, cachedRouter, kakaoLink, kakaoRouter, newRouteMeter, routeKey } from '../src/meeting/route.js';
import { type PlanEdit, SCHEDULE, type PlanProposal, type ScheduleInput, duskKst, revisePlans, schedulePlans } from '../src/meeting/schedule.js';
import { distanceKm } from '../src/meeting/travel.js';
import type { Board, BoardCandidate, MoveMode, ReviewDecision } from '../src/meeting/types.js';
import type { MustKeepRule, PersonaProfile } from '../src/persona/types.js';
import { MINSU, answersOf, call, createTestApp } from './helpers.js';

/** 시험용 가짜 길찾기: 직선거리로 정해진 값을 돌려주고 부른 수를 셈 (카카오 0회) */
function fakeRouter(opts: { fail?: boolean; noTransit?: boolean } = {}) {
  const calls = { transit: 0, walk: 0, car: 0 };
  const guard = () => {
    if (opts.fail) throw new RouteUnavailable('시험: 카카오 한도');
  };
  const router: RouteClient = {
    async car(a, b) {
      calls.car++;
      guard();
      const km = distanceKm(a, b);
      return { minutes: Math.max(1, Math.round(km * 2 + 3)), distanceM: Math.round(km * 1300), taxiFare: Math.round(4800 + km * 1300), toll: 0 };
    },
    async transit(a, b) {
      calls.transit++;
      guard();
      if (opts.noTransit) return null;
      const km = distanceKm(a, b);
      return { minutes: Math.round(km * 5 + 10), distanceM: Math.round(km * 1300), fare: 1550, transfers: 0, type: 'BUS', lines: ['1003'], url: 'https://map.kakao.com/test' };
    },
    async walk(a, b) {
      calls.walk++;
      guard();
      const km = distanceKm(a, b);
      return { minutes: Math.max(1, Math.round(((km * 1.3) / 4.5) * 60)), distanceM: Math.round(km * 1300), url: null };
    },
  };
  return { router, calls };
}

const profile = (p: Partial<PersonaProfile> = {}): PersonaProfile => ({
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
const include = (label: string): MustKeepRule => ({ type: 'include', label, quote: label, keyword: label, target: 'category', codes: [], start: null, end: null, amount: null });
const member = (id: string, p: Partial<PersonaProfile> = {}, likes: string[] = [], mustKeep: MustKeepRule[] = []): MemberInput => ({
  memberId: id,
  nickname: id,
  title: id,
  likes,
  dislikes: [],
  mustKeep,
  profile: profile(p),
});

let seq = 0;
/** 후보 하나 (기본: 관광지·해변 분류·영업시간 모름) */
const cand = (name: string, lat: number, lng: number, o: Partial<Candidate> = {}): Candidate => ({
  id: `c${++seq}`,
  name,
  type: 12,
  category: null,
  popularity: null,
  crowd: null,
  hours: null,
  open: null,
  restUnknown: false,
  code: 'NA020900',
  rest: null,
  summary: '',
  menu: null,
  lat,
  lng,
  scores: {},
  total: 0,
  reasons: {},
  marks: {},
  forMembers: [],
  ...o,
});
/** 광안리 부근 격자 (한 칸 약 0.9km) */
const near = (name: string, i: number, o: Partial<Candidate> = {}) => cand(name, 35.15 + (i % 4) * 0.008, 129.1 + Math.floor(i / 4) * 0.01, o);
const poolOf = (candidates: Candidate[], dates: string[], lodgings: Candidate[] = []): RetrieveResult => ({
  destination: { regionCode: '26', regionName: '부산광역시', districtCodes: ['500'], label: '부산 수영구' },
  dates,
  candidates,
  nights: dates.length - 1,
  lodgings,
  stages: [],
  excluded: [],
  popularity: { baseYm: null, matched: 0 },
  crowd: { fetched: [], cached: [], matched: 0, note: null },
  sources: [],
  baseDate: '2026-10-23',
  outsideRules: [],
  nameMatches: [],
  missingRules: [],
});
/** 보드: 모든 후보를 올림. extra로 고른 AI·반응을 줌 */
const boardOf = (cands: Candidate[], extra: Record<string, Partial<BoardCandidate>> = {}): Board => ({
  candidates: cands.map((c) => ({ placeId: `plc_${c.id}`, name: c.name, lat: c.lat, lng: c.lng, proposedBy: [], reactions: [], ...extra[c.id] })),
  agenda: [],
});
const sights = (plan: PlanProposal, day = 0) => plan.route[day].stops.filter((s) => s.kind === 'sight');
const ids = (plan: PlanProposal) => new Set(plan.route.flatMap((d) => d.stops.filter((s) => s.kind === 'sight').map((s) => s.placeId)));

async function testDb() {
  const { db } = await createTestApp();
  await db.insert(regions).values([{ regionCode: '26', regionName: '부산광역시', districtCode: '500', districtName: '수영구' }]);
  await db.insert(categories).values([
    { code: 'FD010100', name1: '음식', name2: '한식', name3: '관광식당' },
    { code: 'FD050100', name1: '음식', name2: '카페/ 찻집', name3: '카페' },
  ]);
  return db;
}
type TestDb = Awaited<ReturnType<typeof testDb>>;
/** DB의 식당 (6단계가 끼니로 보충) */
const restaurant = (id: string, title: string, lat: number, lng: number, intro: Record<string, string>, lcls3 = 'FD010100') => ({
  contentId: id,
  contentTypeId: 39,
  title,
  regionCode: '26',
  districtCode: '500',
  lcls1: 'FD',
  lcls3,
  lat,
  lng,
  visible: true,
  listRaw: {},
  overview: null,
  introRaw: intro,
  detailSyncedAt: new Date(),
});
const run = (db: TestDb, router: RouteClient, pool: RetrieveResult, board: Board, members: MemberInput[], o: { decision?: ReviewDecision | null; moveMode?: MoveMode } = {}) =>
  schedulePlans(db, router, { meetingId: 'mtg_test1', pool, board, members, decision: o.decision ?? null, moveMode: o.moveMode ?? 'transit' }).then((r) => r.plans);

// 시험마다 PGlite DB를 새로 만들어(같은 구간 저장분이 다음 결과를 바꾸지 않게) 느린 CI에서는 5초를 넘음 → 이 묶음만 20초
describe('6단계 동선 짜기 (가짜 길찾기, LLM 0 · 카카오 0)', { timeout: 20_000 }, () => {
  it('하루 관광지 수는 참여한 사람(2·3·4명)마다 원하는 장소 수의 평균 (반올림, 2–6)', async () => {
    const db = await testDb();
    const cands = Array.from({ length: 12 }, (_, i) => near(`관광지${i}`, i));
    const pool = poolOf(cands, ['2026-11-07']);
    const { router } = fakeRouter();
    const cases: [PersonaProfile['placesPerDay'][], number][] = [
      [[[2, 3], [5, 6]], 4], // (2.5 + 5.5) ÷ 2 = 4
      [[[2, 3], [2, 3], [3, 4]], 3], // 8.5 ÷ 3 = 2.8 → 3
      [[[5, 6], [5, 6], [5, 6], [5, 6]], 6], // 5.5 → 6
    ];
    for (const [paces, want] of cases) {
      const members = paces.map((p, i) => member(`mem_${i}`, { placesPerDay: p }));
      const [A, B] = await run(db, router, pool, boardOf(cands), members);
      expect(sights(A)).toHaveLength(want);
      expect(sights(B)).toHaveLength(want);
    }
  });

  it('A·B 모두 꼭 지킬 곳을 넣고, B는 꼭 지킬 곳·A의 1순위 말고는 A와 겹치지 않음 (plan.proposed 형식)', async () => {
    const db = await testDb();
    const spa = near('온천', 5, { code: 'EX050100', marks: { mem_1: [{ kind: 'must', label: '온천' }] } });
    const cands = [spa, ...Array.from({ length: 15 }, (_, i) => near(`관광지${i}`, i))];
    const members = [member('mem_1', {}, [], [include('온천')]), member('mem_2')];
    const board = boardOf(cands, { [cands[3].id]: { proposedBy: ['agt_2'] } });
    const [A, B] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07', '2026-11-08'], [near('호텔', 2, { type: 32, code: 'AC010100' })]), board, members);
    expect([A.label, B.label]).toEqual(['A', 'B']);
    expect(A).toMatchObject({ planId: 'pln_test1_a', version: 1, moveMode: 'transit', lodging: { name: '호텔' } });
    expect(A.route.map((d) => [d.day, d.date])).toEqual([
      [1, '2026-11-07'],
      [2, '2026-11-08'],
    ]);
    // 명세서 stops 칸 (itemId·name·lat·lng) + placeId·종류·가는 길
    for (const s of A.route.flatMap((d) => d.stops)) expect(s).toMatchObject({ itemId: expect.stringMatching(/^itm_a\d_\d+$/), placeId: expect.stringMatching(/^plc_/), name: expect.any(String), lat: expect.any(Number), lng: expect.any(Number) });
    // 1박: 1일째는 숙소로 끝나고 2일째는 숙소에서 시작함
    expect(A.route[0].stops.at(-1)).toMatchObject({ kind: 'lodging', name: '호텔' });
    expect(A.route[1].stops[0]).toMatchObject({ kind: 'lodging', moveFromPrev: null });
    const a = ids(A);
    const b = ids(B);
    expect(a.has(`plc_${spa.id}`) && b.has(`plc_${spa.id}`)).toBe(true);
    expect(A.route.flatMap((d) => d.stops).find((s) => s.placeId === `plc_${spa.id}`)!.mustFor).toEqual(['mem_1']);
    const shared = [...b].filter((id) => a.has(id));
    expect(shared).toContain(`plc_${cands[3].id}`); // A의 1순위 (고른 AI가 있는 곳)
    expect(shared).toHaveLength(2); // 꼭 지킬 곳 + A의 1순위
  });

  it('그날 쉬는 곳은 그날에 넣지 않고 다음 순위 곳으로 채우며, 꼭 지킬 곳은 여는 날로 옮김 (10/27 결정)', async () => {
    const db = await testDb();
    // 2026-11-07 토요일 · 11-08 일요일
    const spa = near('온천', 5, { code: 'EX050100', rest: '매주 일요일', marks: { mem_1: [{ kind: 'must', label: '온천' }] } });
    const museum = near('미술관', 6, { code: 'VE070600', rest: '매주 토요일', marks: { mem_2: [{ kind: 'must', label: '미술관' }] } });
    const sundayOff = Array.from({ length: 6 }, (_, i) => near(`일요일휴무${i}`, i, { rest: '매주 일요일', popularity: 100 }));
    const others = Array.from({ length: 10 }, (_, i) => near(`관광지${i}`, i + 6));
    const cands = [spa, museum, ...sundayOff, ...others];
    const members = [member('mem_1', {}, [], [include('온천')]), member('mem_2', {}, [], [include('미술관')])];
    const [A, B] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07', '2026-11-08'], [near('호텔', 2, { type: 32, code: 'AC010100' })]), boardOf(cands), members);
    for (const plan of [A, B]) {
      const day = (d: number) => new Set(plan.route[d].stops.map((s) => s.placeId));
      for (const c of [spa, ...sundayOff]) expect(day(1).has(`plc_${c.id}`)).toBe(false); // 일요일에 일요일 휴무인 곳 없음
      expect(day(0).has(`plc_${museum.id}`)).toBe(false); // 토요일에 토요일 휴무인 곳 없음
      expect(day(0).has(`plc_${spa.id}`)).toBe(true); // 꼭 지킬 곳은 여는 날로
      expect(day(1).has(`plc_${museum.id}`)).toBe(true);
      expect(sights(plan, 0)).toHaveLength(4); // 빈자리는 다음 순위 곳으로 채움 (하루 관광지 수 그대로)
      expect(sights(plan, 1)).toHaveLength(4);
    }
  });

  it('✕가 붙은 곳은 빼되 5단계에서 사람이 남기기로 한 곳은 넣고, 사람이 뺀 곳은 다시 넣지 않음', async () => {
    const db = await testDb();
    const cands = Array.from({ length: 6 }, (_, i) => near(`관광지${i}`, i));
    const [x, y] = cands;
    const members = [member('mem_1'), member('mem_2')];
    const board = boardOf(cands, {
      [x.id]: { proposedBy: ['agt_1'], reactions: [{ agentId: 'agt_2', kind: 'block', reason: '영업 끝' }] },
      [y.id]: { proposedBy: ['agt_1', 'agt_2'] },
    });
    const pool = poolOf(cands, ['2026-11-07']);
    const [A] = await run(db, fakeRouter().router, pool, board, members);
    expect(ids(A).has(`plc_${x.id}`)).toBe(false);
    expect(ids(A).has(`plc_${y.id}`)).toBe(true);
    const decision: ReviewDecision = { kept: [`plc_${x.id}`], dropped: [`plc_${y.id}`], votes: [], responded: ['mem_1', 'mem_2'], defaulted: [], closedBy: 'all' };
    const [A2, B2] = await run(db, fakeRouter().router, pool, { ...board, candidates: board.candidates.filter((c) => c.placeId !== `plc_${y.id}`) }, members, { decision });
    expect(ids(A2).has(`plc_${x.id}`)).toBe(true);
    expect(ids(A2).has(`plc_${y.id}`) || ids(B2).has(`plc_${y.id}`)).toBe(false);
  });

  it('야경 좋아요가 있으면 해가 12° 지는 때(항해박명 끝)에 여는 전망대를 저녁 뒤 마지막에 두고, 18시에 닫는 전망대는 야경 자리에 두지 않음', async () => {
    const db = await testDb();
    const tower = near('밤 전망대', 1, { code: 'VE010200', open: { open: 600, close: 1320 } });
    const early = near('18시 전망대', 2, { code: 'VE010200', open: { open: 540, close: 1080 } });
    const cands = [tower, early, near('해변', 3), near('공원', 4)];
    await db.insert(places).values([restaurant('r1', '점심식당', 35.158, 129.1, { opentimefood: '10:00~22:00' }), restaurant('r2', '저녁식당', 35.166, 129.11, { opentimefood: '10:00~22:00' })]);
    const members = [member('mem_1', { placesPerDay: [3, 4] }, ['like_night']), member('mem_2', { placesPerDay: [3, 4] })];
    const board = boardOf(cands, { [tower.id]: { proposedBy: ['agt_1'] }, [early.id]: { proposedBy: ['agt_2'] } });
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), board, members);
    const stops = A.route[0].stops;
    expect(stops.at(-1)).toMatchObject({ name: '밤 전망대', night: true });
    expect(stops.at(-2)).toMatchObject({ kind: 'food', meal: 'dinner' });
    expect(stops.find((s) => s.name === '18시 전망대')).toMatchObject({ night: false });
    // 계산 확인: 부산 11월 일몰 약 17:25, 항해박명 끝 약 18:20 (18시에 닫는 곳은 닫힌 뒤)
    const dusk = duskKst({ lat: 35.15, lng: 129.1 }, '2026-11-07', SCHEDULE.night.zenith)!;
    expect(dusk).toBeGreaterThan(18 * 60);
    expect(dusk).toBeLessThan(18 * 60 + 40);
    // 야경 좋아요가 없으면 마지막에 두지 않음
    const [A2] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), board, [member('mem_1'), member('mem_2')]);
    expect(A2.route[0].stops.some((s) => s.night)).toBe(false);
  });

  it('시작 시각이 모두 저녁 뒤인 곳(밤 행사·야시장)은 저녁 뒤에 두고, 하루가 저녁 전에 끝나면 넣지 않음', async () => {
    const db = await testDb();
    const show = near('드론쇼', 1, { id: 'ev1', type: 15, code: 'EV030400', open: null });
    const market = near('야시장', 2, { open: { open: 18 * 60, close: 23 * 60 } });
    const cands = [show, market, near('해변', 3), near('공원', 4), near('박물관', 5)];
    await db.insert(places).values([
      { ...restaurant('ev1', '드론쇼', 35.158, 129.1, { playtime: '- 하절기(3월~9월) 20:00, 22:00- 동절기(10월~2월) 19:00, 21:00' }), contentTypeId: 15, lcls1: 'EV', lcls3: 'EV030400' },
      restaurant('r1', '점심식당', 35.158, 129.11, { opentimefood: '10:00~22:00' }),
      restaurant('r2', '저녁식당', 35.166, 129.11, { opentimefood: '10:00~22:00' }),
    ]);
    const board = boardOf(cands, { [show.id]: { proposedBy: ['agt_1'] }, [market.id]: { proposedBy: ['agt_2'] } });
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), board, [member('mem_1', { placesPerDay: [5, 6] }), member('mem_2', { placesPerDay: [5, 6] })]);
    const names = A.route[0].stops.map((s) => s.name);
    const dinner = A.route[0].stops.findIndex((s) => s.meal === 'dinner');
    expect(dinner).toBeGreaterThan(0);
    expect(names.indexOf('드론쇼')).toBeGreaterThan(dinner);
    expect(names.indexOf('야시장')).toBeGreaterThan(dinner);
    const early = [member('mem_1', { placesPerDay: [5, 6], endTime: '17:00' }), member('mem_2', { placesPerDay: [5, 6] })];
    const [E] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), board, early);
    expect(E.route[0].stops.map((s) => s.name)).not.toContain('드론쇼');
    expect(E.route[0].stops.map((s) => s.name)).not.toContain('야시장');
  });

  it('끼니: 점심은 관광지 절반 뒤·저녁은 마지막 관광지 뒤, 그날 쉬거나 끼니 시간에 닫힌 식당·카페는 끼니로 쓰지 않음 (DB의 식당으로 보충)', async () => {
    const db = await testDb();
    const cafe = near('보드 카페', 6, { type: 39, code: 'FD050100' });
    const cands = [near('관광지0', 0), near('관광지1', 1), near('관광지2', 4), near('관광지3', 5), cafe];
    await db.insert(places).values([
      restaurant('r_ok', '연중무휴식당', 35.158, 129.1, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
      restaurant('r_ok2', '두번째식당', 35.16, 129.11, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
      restaurant('r_sat', '토요휴무식당', 35.157, 129.105, { restdatefood: '매주 토요일', opentimefood: '11:00~21:00' }), // 2026-11-07은 토요일
      restaurant('r_night', '저녁만식당', 35.159, 129.104, { restdatefood: '연중무휴', opentimefood: '17:00~23:00' }),
      restaurant('r_cafe', '디비카페', 35.158, 129.104, { restdatefood: '연중무휴' }, 'FD050100'),
    ]);
    const members = [member('mem_1', { placesPerDay: [5, 6] }), member('mem_2', { placesPerDay: [5, 6] })];
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), boardOf(cands, { [cafe.id]: { proposedBy: ['agt_1'] } }), members);
    const stops = A.route[0].stops;
    const lunch = stops.findIndex((s) => s.meal === 'lunch');
    const dinner = stops.findIndex((s) => s.meal === 'dinner');
    expect(lunch).toBeGreaterThan(0);
    expect(dinner).toBe(stops.length - 1); // 숙소·야경 없는 당일치기
    const sightCount = stops.filter((s) => s.kind === 'sight').length;
    expect(stops.slice(0, lunch).filter((s) => s.kind === 'sight')).toHaveLength(Math.floor(sightCount / 2));
    const meals = stops.filter((s) => s.kind === 'food').map((s) => s.name);
    expect(meals).toHaveLength(2);
    for (const bad of ['토요휴무식당', '디비카페', '보드 카페']) expect(meals).not.toContain(bad);
    expect(stops[lunch].name).not.toBe('저녁만식당');
    expect(stops.find((s) => s.name === '보드 카페')).toMatchObject({ kind: 'sight' }); // 카페는 관광지처럼
  });

  it('꼭 지킬 식당은 한 번만: 다른 날에 넣어 둔 꼭 지킬 식당을 그날 끼니로 다시 쓰지 않음 (10/28 점검: 1일째 점심·2일째 저녁에 같은 식당)', async () => {
    const db = await testDb();
    const spa = near('온천', 5, { code: 'EX050100', marks: { mem_1: [{ kind: 'must', label: '온천' }] } });
    // 꼭 지킬 식당이 관광지 묶음 바로 옆에 있어 1일째 끼니로도 가장 좋아 보임
    const gukbap = near('국밥집', 6, { type: 39, code: 'FD010100', marks: { mem_1: [{ kind: 'must', label: '돼지국밥' }] } });
    const cands = [spa, gukbap, ...Array.from({ length: 10 }, (_, i) => near(`관광지${i}`, i))];
    await db.insert(places).values([
      restaurant('r_far1', '먼식당1', 35.2, 129.16, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
      restaurant('r_far2', '먼식당2', 35.21, 129.17, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
      restaurant('r_far3', '먼식당3', 35.22, 129.18, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
    ]);
    const members = [member('mem_1', {}, [], [include('온천'), include('돼지국밥')]), member('mem_2')];
    const hotel = near('호텔', 2, { type: 32, code: 'AC010100' });
    const [A, B] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07', '2026-11-08'], [hotel]), boardOf(cands), members);
    for (const plan of [A, B]) expect(plan.route.flatMap((d) => d.stops).filter((x) => x.placeId === `plc_${gukbap.id}`)).toHaveLength(1);
  });

  it("꼭 먹을 음식·꼭 피할 곳의 이름 규칙은 2단계 AI가 고른 식당 id로만 맞춤 (코드는 이름·메뉴 글자로 찾지 않음, 10/29 '가')", async () => {
    const db = await testDb();
    const cands = Array.from({ length: 8 }, (_, i) => near(`관광지${i}`, i));
    await db.insert(places).values([
      restaurant('r_text', '돼지국밥집', 35.158, 129.1, { restdatefood: '연중무휴', opentimefood: '11:00~21:00', firstmenu: '돼지국밥' }),
      restaurant('r_ai', '초량식당', 35.16, 129.11, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
      restaurant('r_avoid', '바로옆식당', 35.159, 129.105, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
    ]);
    const gukbap: MustKeepRule = { type: 'include', label: '돼지국밥 먹기', quote: '돼지국밥은 꼭', keyword: '돼지국밥', target: 'food', codes: [], start: null, end: null, amount: null };
    const nope: MustKeepRule = { type: 'avoid', label: '바로옆식당 빼기', quote: '바로옆식당은 싫어요', keyword: '바로옆식당', target: 'place', codes: [], start: null, end: null, amount: null };
    const members = [member('mem_1', {}, [], [gukbap]), member('mem_2', {}, [], [nope])];
    const pool: RetrieveResult = {
      ...poolOf(cands, ['2026-11-07']),
      nameMatches: [
        { memberId: 'mem_1', type: 'include', label: '돼지국밥 먹기', keyword: '돼지국밥', places: ['초량식당'], ids: ['r_ai'] },
        { memberId: 'mem_2', type: 'avoid', label: '바로옆식당 빼기', keyword: '바로옆식당', places: ['바로옆식당'], ids: ['r_avoid'] },
      ],
    };
    const [A, B] = await run(db, fakeRouter().router, pool, boardOf(cands), members);
    for (const plan of [A, B]) {
      const food = plan.route.flatMap((d) => d.stops).filter((x) => x.kind === 'food');
      expect(food.find((x) => x.placeId === 'plc_r_ai')?.mustFor).toEqual(['mem_1']);
      expect(food.find((x) => x.placeId === 'plc_r_text')?.mustFor ?? []).toEqual([]);
      expect(food.some((x) => x.placeId === 'plc_r_avoid')).toBe(false);
    }
    // AI 답이 없으면(빈 기록) 꼭 먹을 식당 표시도, 피할 곳 거르기도 하지 않음
    const [plain] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), boardOf(cands), members);
    expect(plain.route.flatMap((d) => d.stops).some((x) => x.mustFor.length > 0)).toBe(false);
  });

  it('지역 넣기 규칙은 DB에서 보충하는 식당에 꼭 지킬 표시를 붙이지 않음 (그 구·군의 식당이 모두 꼭 지킬 곳이 되지 않게)', async () => {
    const db = await testDb();
    const cands = Array.from({ length: 8 }, (_, i) => near(`관광지${i}`, i));
    await db.insert(places).values([
      restaurant('r_a', '수영식당1', 35.158, 129.1, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
      restaurant('r_b', '수영식당2', 35.16, 129.11, { restdatefood: '연중무휴', opentimefood: '11:00~21:00' }),
    ]);
    const area: MustKeepRule = { type: 'include', label: '수영 쪽 위주로', quote: '수영 쪽 위주로', keyword: '수영', target: 'area', codes: [], start: null, end: null, amount: null };
    const members = [member('mem_1', {}, [], [area]), member('mem_2')];
    const [A, B] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), boardOf(cands), members);
    for (const plan of [A, B]) for (const x of plan.route.flatMap((d) => d.stops).filter((s) => s.kind === 'food')) expect(x.mustFor).toEqual([]);
  });

  it('하루 관광지가 많아도(꼭 지킬 곳 10곳) 모든 순서를 만들지 않고 빨리 짬 (10/28 점검: 10곳의 모든 순서는 363만 가지라 서버가 멈춤)', async () => {
    const db = await testDb();
    const musts = Array.from({ length: 10 }, (_, i) => near(`꼭${i}`, i, { marks: { mem_1: [{ kind: 'must', label: `규칙${i}` }] } }));
    const cands = [...musts, ...Array.from({ length: 4 }, (_, i) => near(`관광지${i}`, 10 + i))];
    const members = [member('mem_1', {}, [], musts.map((_, i) => include(`규칙${i}`))), member('mem_2')];
    const started = Date.now();
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), boardOf(cands), members);
    expect(Date.now() - started).toBeLessThan(5000);
    const inPlan = new Set(sights(A).map((x) => x.placeId));
    for (const p of musts) expect(inPlan.has(`plc_${p.id}`)).toBe(true);
    expect(SCHEDULE.orderAllMax).toBeLessThan(musts.length);
  });

  it('식당이 모자라면 일정은 그대로 짜고 메모로 알림', async () => {
    const db = await testDb();
    const cands = [near('관광지0', 0), near('관광지1', 1), near('관광지2', 2)];
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), boardOf(cands), [member('mem_1'), member('mem_2')]);
    expect(sights(A)).toHaveLength(3);
    expect(A.notes).toContain('1일째 점심 — 그날 여는 식당을 찾지 못함');
    expect(A.notes).toContain('1일째 저녁 — 그날 여는 식당을 찾지 못함');
  });

  describe('구간 가는 길 (카카오가 준 값을 그대로)', () => {
    // 끼니 없는 하루(14–17시)에 관광지 두 곳만: 구간 1개
    const pair = (km: number) => [near('출발', 0), cand('도착', 35.15 + km / 111, 129.1)];
    const shortDay = (o: Partial<PersonaProfile> = {}) => [member('mem_1', { startTime: '14:00', endTime: '17:00', ...o }), member('mem_2', { startTime: '14:00', endTime: '17:00' })];
    const legOf = async (cands: Candidate[], router: RouteClient, members: MemberInput[], moveMode: MoveMode = 'transit') => {
      const db = await testDb();
      const [A] = await run(db, router, poolOf(cands, ['2026-11-07']), boardOf(cands), members, { moveMode });
      expect(A.route[0].stops).toHaveLength(2);
      return A.route[0].stops[1].moveFromPrev!;
    };

    it('걸어갈 거리면 도보, 멀면 대중교통을 권하고 택시를 선택지로 함께 줌 (택시 1인 요금 = 한 대 ÷ 인원)', async () => {
      const walk = await legOf(pair(0.3), fakeRouter().router, shortDay());
      expect(walk).toMatchObject({ mode: 'walk', source: 'kakao_route', fareWon: 0, options: { walk: { minutes: expect.any(Number) } } });
      const far = await legOf(pair(5), fakeRouter().router, shortDay());
      expect(far).toMatchObject({ mode: 'bus', minutes: 35, fareWon: 1550, source: 'kakao_route', routeUrl: 'https://map.kakao.com/test' });
      expect(far.options.transit).toMatchObject({ minutes: 35, lines: ['1003'] });
      expect(far.options.car).toMatchObject({ minutes: 13, taxiFareWon: 11311, taxiPerPersonWon: 5700 });
    });

    it('대중교통 경로가 없거나, 대중교통이 한 번 이동 상한을 넘고 택시는 안 넘으면 택시. 자차면 자동차만', async () => {
      expect(await legOf(pair(5), fakeRouter({ noTransit: true }).router, shortDay())).toMatchObject({ mode: 'taxi', minutes: 13, fareWon: 5700, note: '대중교통 경로 없음' });
      expect(await legOf(pair(5), fakeRouter().router, shortDay({ maxMoveMinutes: 20 }))).toMatchObject({ mode: 'taxi', note: expect.stringContaining('한 번 이동 상한 20분') });
      const { router, calls } = fakeRouter();
      const car = await legOf(pair(5), router, shortDay(), 'car');
      expect(car).toMatchObject({ mode: 'car', minutes: 13, fareWon: null });
      expect(car.options.transit).toBeUndefined();
      expect(calls.transit).toBe(0);
    });

    it('카카오를 못 쓰면(한도·오류) 회의는 그대로 끝나고 그 구간은 시간 없이 직선거리만 (estimate), 메모는 못 물은 것과 경로 없음을 나눔', async () => {
      const leg = await legOf(pair(5), fakeRouter({ fail: true }).router, shortDay());
      expect(leg).toMatchObject({ mode: null, minutes: null, source: 'estimate', note: '길찾기 정보 없음' });
      expect(leg.distanceM).toBeGreaterThan(4900);
      const db = await testDb();
      const cands = pair(5);
      const [failed] = await run(db, fakeRouter({ fail: true }).router, poolOf(cands, ['2026-11-07']), boardOf(cands), shortDay());
      expect(failed.notes).toContain('길찾기 정보 없는 구간 1개 (카카오 한도·오류·교통 장애) — 직선거리만 표시');
      const noCar: RouteClient = { ...fakeRouter().router, car: async () => null };
      const [none] = await run(db, noCar, poolOf(cands, ['2026-11-07']), boardOf(cands), shortDay(), { moveMode: 'car' });
      expect(none.route[0].stops[1].moveFromPrev).toMatchObject({ source: 'estimate', note: '자동차 경로 없음' });
      expect(none.notes).toContain('카카오가 경로를 찾지 못한 구간 1개 — 직선거리만 표시');
    });
  });

  it('한 번 이동이 가장 엄격한 상한을 넘으면(택시로도) 그 구간 끝의 관광지(꼭 지킬 곳 아님)를 빼고 다시 짬', async () => {
    const db = await testDb();
    const far = cand('먼 곳', 35.15 + 30 / 111, 129.1);
    const cands = [near('관광지0', 0), near('관광지1', 1), near('관광지2', 2), far];
    const members = [member('mem_1', { startTime: '14:00', endTime: '17:00', maxMoveMinutes: 40 }), member('mem_2', { startTime: '14:00', endTime: '17:00' })];
    const board = boardOf(cands, { [far.id]: { proposedBy: ['agt_1', 'agt_2'] } });
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07']), board, members);
    expect(sights(A).map((s) => s.name)).not.toContain('먼 곳');
    expect(sights(A)).toHaveLength(3);
    expect(A.notes.some((n) => n.startsWith('1일째 먼 곳 뺌') && n.includes('상한 40분'))).toBe(true);
  });

  it('긴 이동의 떨어진 쪽이 숙소면 관광지를 빼지 않음 (빼도 숙소까지 가는 긴 이동이 남음)', async () => {
    const db = await testDb();
    const cands = Array.from({ length: 8 }, (_, i) => near(`관광지${i}`, i));
    const hotel = cand('먼 호텔', 35.15 + 30 / 111, 129.1, { type: 32, code: 'AC010100' });
    const members = [member('mem_1', { startTime: '14:00', endTime: '17:00', maxMoveMinutes: 40 }), member('mem_2', { startTime: '14:00', endTime: '17:00' })];
    const [A] = await run(db, fakeRouter().router, poolOf(cands, ['2026-11-07', '2026-11-08'], [hotel]), boardOf(cands), members);
    expect(A.route[1].stops[0]).toMatchObject({ kind: 'lodging', name: '먼 호텔' });
    expect(A.route[1].stops[1].moveFromPrev!.minutes).toBeGreaterThan(40);
    expect(A.notes.some((n) => n.includes('뺌'))).toBe(false);
  });

  it('카카오는 회의당 상한까지만 부르고, 2일 여행 A·B는 상한보다 훨씬 적게 부름', async () => {
    const db = await testDb();
    const cands = Array.from({ length: 16 }, (_, i) => near(`관광지${i}`, i));
    const { router, calls } = fakeRouter();
    const meter = newRouteMeter();
    await run(db, cachedRouter(db, router, meter), poolOf(cands, ['2026-11-07', '2026-11-08'], [near('호텔', 2, { type: 32, code: 'AC010100' })]), boardOf(cands), [member('mem_1'), member('mem_2')]);
    const used = meter.calls.transit + meter.calls.walk + meter.calls.car;
    expect(used).toBe(calls.transit + calls.walk + calls.car);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThan(ROUTE.perMeeting / 2);
    expect(meter.cached).toBeGreaterThan(0); // B안·같은 구간은 저장된 것을 씀
  });
});

describe('6단계 길찾기 저장·카카오 호출기', () => {
  const a = { lat: 35.15, lng: 129.1 };
  const b = { lat: 35.2, lng: 129.15 };

  it('회의 안에서 같은 구간을 동시에 물어도 카카오는 한 번만 부름 (A·B안이 같은 구간을 함께 물을 때)', async () => {
    const db = await testDb();
    const { router, calls } = fakeRouter();
    const meter = newRouteMeter();
    const r = cachedRouter(db, router, meter);
    await Promise.all([r.transit(a, b), r.transit(a, b), r.car(a, b), r.car(b, a)]);
    expect(calls).toEqual({ transit: 1, walk: 0, car: 1 });
    expect(meter).toMatchObject({ calls: { transit: 1, walk: 0, car: 1 }, cached: 2 });
  });

  it('9단계 라운드마다 새로 만드는 호출기도 회의 전체 수를 이어서 세고(회의당 상한), 이 회의에서 못 쓴 구간은 다시 부르지 않음 (10/29)', async () => {
    const db = await testDb();
    const { router, calls } = fakeRouter({ fail: true }); // 교통 장애처럼 저장하지 않는 실패
    const meter = newRouteMeter();
    const failed = new Set<string>();
    await expect(cachedRouter(db, router, meter, undefined, failed).transit(a, b)).rejects.toThrow(RouteUnavailable);
    expect(calls.transit).toBe(1);
    expect(failed.has(routeKey('transit', a, b))).toBe(true);
    // 다음 라운드: 새 호출기 + 이어 받은 수·못 쓴 구간 → 카카오를 다시 부르지 않음
    const next = { ...meter, calls: { ...meter.calls } };
    await expect(cachedRouter(db, router, next, undefined, new Set(failed)).transit(a, b)).rejects.toThrow(RouteUnavailable);
    expect(calls.transit).toBe(1);
    // 회의당 상한까지 쓴 수를 이어 받으면 새 구간도 부르지 않음
    const full = { ...newRouteMeter(), calls: { transit: 0, walk: 0, car: ROUTE.perMeeting } };
    const ok = fakeRouter();
    await expect(cachedRouter(db, ok.router, full).car(a, { lat: 35.3, lng: 129.2 })).rejects.toThrow(RouteUnavailable);
    expect(ok.calls.car).toBe(0);
  });

  it('카카오가 준 길찾기 링크는 https의 카카오맵 주소만 화면에 넘김', () => {
    expect(kakaoLink('https://map.kakao.com/?sX=1&sY=2')).toBe('https://map.kakao.com/?sX=1&sY=2');
    expect(kakaoLink('javascript:alert(1)')).toBeNull();
    expect(kakaoLink('http://map.kakao.com/')).toBeNull();
    expect(kakaoLink('https://map.kakao.com.evil.example/')).toBeNull();
    expect(kakaoLink(42)).toBeNull();
  });

  it('같은 구간은 7일 동안 저장해 다시 쓰고(자동차는 오가는 방향이 같은 구간), 회의당 상한을 넘으면 부르지 않음', async () => {
    const db = await testDb();
    const { router, calls } = fakeRouter();
    let now = new Date('2026-10-23T00:00:00Z');
    const meter = newRouteMeter();
    const r = cachedRouter(db, router, meter, () => now);
    await r.car(a, b);
    await r.car(b, a);
    await r.transit(a, b);
    await r.transit(b, a);
    expect(calls).toEqual({ transit: 2, walk: 0, car: 1 });
    expect(meter).toMatchObject({ calls: { transit: 2, walk: 0, car: 1 }, cached: 1 });
    expect(routeKey('car', a, b)).toBe(routeKey('car', b, a));
    expect(routeKey('transit', a, b)).not.toBe(routeKey('transit', b, a));
    now = new Date(now.getTime() + (ROUTE.cacheDays + 1) * 86400000);
    await r.car(a, b);
    expect(calls.car).toBe(2);
    // 경로 없음(null)도 저장해 다시 묻지 않음
    const none = cachedRouter(db, fakeRouter({ noTransit: true }).router, newRouteMeter());
    const c = { lat: 35.3, lng: 129.2 };
    expect(await none.transit(a, c)).toBeNull();
    const again = fakeRouter();
    expect(await cachedRouter(db, again.router, newRouteMeter()).transit(a, c)).toBeNull();
    expect(again.calls.transit).toBe(0);
    // 상한·키 없음: 저장된 구간만 쓰고 나머지는 RouteUnavailable
    const full = newRouteMeter();
    full.calls.car = ROUTE.perMeeting;
    const capped = fakeRouter();
    await expect(cachedRouter(db, capped.router, full).walk(a, b)).rejects.toBeInstanceOf(RouteUnavailable);
    expect(capped.calls.walk).toBe(0);
    await expect(cachedRouter(db, null, newRouteMeter()).walk(b, c)).rejects.toBeInstanceOf(RouteUnavailable);
    expect(await cachedRouter(db, null, newRouteMeter()).transit(a, b)).not.toBeNull();
    expect((await db.select().from(routeCache)).length).toBeGreaterThan(0);
  });

  it('카카오 응답을 읽음: 대중교통은 첫 경로, 경로 없음은 null, 429·하루 한도는 RouteUnavailable (키는 머리글로만)', async () => {
    const seen: { url: string; auth: string }[] = [];
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    let next: Response = reply(200, {});
    const fetchFake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) });
      return next;
    }) as typeof fetch;
    let allow = true;
    const k = kakaoRouter({ restKey: 'test-key', mapBase: 'https://map.test', naviBase: 'https://navi.test', timeoutMs: 1000, fetch: fetchFake, beforeCall: async () => allow });
    next = reply(200, {
      status: 'OK',
      properties: { landingURL: 'https://map.kakao.com/link/by/traffic/x' },
      routes: [
        { properties: { totalTime: 1860, totalDistance: 4800, transfers: 1, type: 'BUS_AND_SUBWAY', fare: { value: 1550 } }, steps: [{ properties: { vehicles: [{ name: '1003' }] } }, { properties: { vehicles: [{ name: '2호선' }] } }] },
        { properties: { totalTime: 600, totalDistance: 4000, transfers: 3, type: 'BUS' }, steps: [] },
      ],
    });
    expect(await k.transit({ lat: 35.1, lng: 129.0 }, { lat: 35.2, lng: 129.1 })).toEqual({ minutes: 31, distanceM: 4800, fare: 1550, transfers: 1, type: 'BUS_AND_SUBWAY', lines: ['1003', '2호선'], url: 'https://map.kakao.com/link/by/traffic/x' });
    expect(seen[0].url).toBe('https://map.test/v2/routing/publictraffic?start_x=129&start_y=35.1&end_x=129.1&end_y=35.2');
    expect(seen[0].auth).toBe('KakaoAK test-key');
    next = reply(200, { status: 'NO_RESULTS', routes: [] });
    expect(await k.transit({ lat: 35.1, lng: 129.0 }, { lat: 35.1001, lng: 129.0 })).toBeNull();
    next = reply(200, { status: 'OK', route: { properties: { totalTime: 444, totalDistance: 344, landingUrl: 'https://map.kakao.com/w' } } });
    expect(await k.walk({ lat: 35.1, lng: 129.0 }, { lat: 35.101, lng: 129.0 })).toEqual({ minutes: 7, distanceM: 344, url: 'https://map.kakao.com/w' });
    next = reply(200, { routes: [{ result_code: 0, summary: { duration: 4260, distance: 20700, fare: { taxi: 25100, toll: 0 } } }] });
    expect(await k.car({ lat: 35.1, lng: 129.0 }, { lat: 35.2, lng: 129.1 })).toEqual({ minutes: 71, distanceM: 20700, taxiFare: 25100, toll: 0 });
    expect(seen.at(-1)!.url).toBe('https://navi.test/v1/directions?origin=129%2C35.1&destination=129.1%2C35.2&summary=true');
    next = reply(200, { routes: [{ result_code: 104, result_msg: '출발지와 도착지가 너무 가까움' }] });
    expect(await k.car({ lat: 35.1, lng: 129.0 }, { lat: 35.1, lng: 129.0 })).toBeNull();
    // 도착 지점 주변 교통 장애(유고)는 잠깐의 일이라 '경로 없음'으로 저장하지 않고 물어보지 못한 것으로 봄
    next = reply(200, { routes: [{ result_code: 106, result_msg: '도착 지점 주변의 도로에 유고 정보(교통 장애)가 있음' }] });
    await expect(k.car({ lat: 35.1, lng: 129.0 }, { lat: 35.2, lng: 129.1 })).rejects.toBeInstanceOf(RouteUnavailable);
    next = reply(429, { msg: 'limit' });
    await expect(k.walk({ lat: 35.1, lng: 129.0 }, { lat: 35.101, lng: 129.0 })).rejects.toThrow('카카오 무료 한도 초과');
    const before = seen.length;
    allow = false;
    await expect(k.car({ lat: 35.1, lng: 129.0 }, { lat: 35.2, lng: 129.1 })).rejects.toThrow('하루 한도');
    expect(seen.length).toBe(before); // 하루 한도면 부르지 않음
  });
});

describe('6단계 회의 조건·인원', () => {
  async function hostOnly() {
    const { app, db } = await createTestApp();
    await db.insert(regions).values([{ regionCode: '26', regionName: '부산광역시', districtCode: '500', districtName: '수영구' }]);
    const t = await call(app, 'POST', '/trips', { title: '혼자', nickname: '민수' });
    return { app, token: t.body.token as string, tripId: t.body.trip.id as string };
  }

  it('현지 이동 수단은 transit·car만 받고, 없으면 transit', async () => {
    const { app, token, tripId } = await hostOnly();
    const base = { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-08' };
    expect((await call(app, 'PUT', `/trips/${tripId}/conditions`, base, token)).body.conditions.moveMode).toBe('transit');
    expect((await call(app, 'PUT', `/trips/${tripId}/conditions`, { ...base, moveMode: 'car' }, token)).body.conditions.moveMode).toBe('car');
    const bad = await call(app, 'PUT', `/trips/${tripId}/conditions`, { ...base, moveMode: 'bike' }, token);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('방장 혼자면(성향을 마쳐도) 회의를 시작하지 않음 (NOT_ENOUGH_MEMBERS, 실행 횟수 안 씀)', async () => {
    const { app, token, tripId } = await hostOnly();
    await call(app, 'POST', '/me/persona', { answers: answersOf(MINSU, ['like_sea'], []) }, token, { 'cf-connecting-ip': '203.0.113.7' });
    await call(app, 'PUT', `/trips/${tripId}/conditions`, { destination: '부산', startDate: '2099-11-07', endDate: '2099-11-07' }, token);
    const res = await call(app, 'POST', `/trips/${tripId}/meetings`, undefined, token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_ENOUGH_MEMBERS');
  });
});

describe('9단계 수정 (요청대로 고치고 바뀐 안만 다시 짬, 가짜 길찾기 · LLM 0 · 카카오 0)', { timeout: 20_000 }, () => {
  /** 당일 여행, 하루 관광지 3곳 (두 사람 모두 [3, 3]). 인기 순으로 점수가 갈리고, 먼 곳은 점수가 가장 낮아 6단계가 고르지 않음 */
  async function setup(o: { extra?: Candidate[]; keepFirst?: boolean; pace?: [number, number]; count?: number; mustKeep?: MustKeepRule[]; moveLimit?: number } = {}) {
    const db = await testDb();
    const cands = [...Array.from({ length: o.count ?? 10 }, (_, i) => near(`관광지${i}`, i, { popularity: 80 - i * 5 })), ...(o.extra ?? [])];
    const far = cand('먼 곳', 35.24, 129.2, { popularity: 0 });
    const limit = { maxMoveMinutes: o.moveLimit ?? null };
    const members = [member('mem_1', { placesPerDay: o.pace ?? [3, 3], ...limit }, [], o.mustKeep ?? []), member('mem_2', { placesPerDay: o.pace ?? [3, 3], ...limit })];
    // keepFirst: 5단계에서 사람이 첫 후보(점수가 가장 높은 관광지)를 남김
    const decision = o.keepFirst ? ({ kept: [`plc_${cands[0].id}`], dropped: [] } as unknown as ReviewDecision) : null;
    const input: ScheduleInput = { meetingId: 'mtg_test1', pool: poolOf([...cands, far], ['2026-11-07']), board: boardOf([...cands, far]), members, decision, moveMode: 'transit' };
    const fake = fakeRouter();
    const first = await schedulePlans(db, fake.router, input);
    const revise = (current: { plans: PlanProposal[]; states: typeof first.states }, edits: PlanEdit[]) => revisePlans(db, fake.router, input, current, edits, { changesPerPlan: 3 });
    return { db, cands, far, first, revise, fake, input };
  }
  const nameOf = (plan: PlanProposal, placeId: string) => plan.route.flatMap((d) => d.stops).find((s) => s.placeId === placeId)?.name;

  it('빼기(그날이 모자라면 6단계 묶음 값으로 채움)·넣기(그날이 다 찼으면 좋아하는 사람이 가장 적고 점수가 낮은 곳과 바꿈): 같은 planId에 version 2, 바뀐 것 글, 바뀌지 않은 B안은 그대로', async () => {
    const { far, first, revise } = await setup();
    const [A, B] = first.plans;
    const out0 = sights(A).map((s) => s.placeId);
    const out = await revise(first, [
      { plan: 'A', type: 'avoid', placeId: out0[1], toId: null },
      { plan: 'A', type: 'include', placeId: `plc_${far.id}`, toId: null },
    ]);
    expect(out.results.map((r) => [r.plan, r.applied])).toEqual([
      ['A', true],
      ['A', true],
    ]);
    expect(out.changed).toEqual(['A']);
    const [A2, B2] = out.plans;
    expect(A2).toMatchObject({ planId: A.planId, version: 2, label: 'A' });
    expect(B2).toBe(B);
    expect(ids(A2).has(out0[1])).toBe(false);
    expect(ids(A2).has(`plc_${far.id}`)).toBe(true);
    expect(sights(A2)).toHaveLength(3);
    expect(A2.changes).toEqual([expect.stringMatching(new RegExp(`^1일째 ${nameOf(A, out0[1])} 뺌 → `)), expect.stringMatching(/^1일째 먼 곳 넣음 \(.+ 뺌\)$/)]);
    expect(out.results[0].note).toMatch(/^A안 1일째/);
    expect(out.states.A.banned).toContain(out0[1].replace(/^plc_/, ''));
    expect(out.states.B).toEqual(first.states.B);
  });

  it('바꾸기는 뺀 날에 바꿀 곳을 넣음 · 긴 이동 줄이기는 그곳을 빼고 그날 가운데에 더 가까운 곳으로만 채움 (version 3)', async () => {
    const { far, first, revise } = await setup();
    const A = first.plans[0];
    const unused = sights(first.plans[1]).map((s) => s.placeId).filter((id) => !ids(A).has(id))[0];
    const first0 = sights(A)[0].placeId;
    const r1 = await revise(first, [
      { plan: 'A', type: 'replace', placeId: first0, toId: unused },
      { plan: 'A', type: 'include', placeId: `plc_${far.id}`, toId: null },
    ]);
    expect(r1.results.every((r) => r.applied)).toBe(true);
    expect(r1.results[0].note).toBe(`A안 1일째 ${nameOf(A, first0)} → ${nameOf(r1.plans[0], unused)}`);
    const r2 = await revise({ plans: r1.plans, states: r1.states }, [{ plan: 'A', type: 'move', placeId: `plc_${far.id}`, toId: null }]);
    expect(r2.results[0]).toMatchObject({ applied: true, note: expect.stringMatching(/^A안 1일째 긴 이동을 줄이려 먼 곳 뺌 → /) });
    expect(r2.plans[0].version).toBe(3);
    expect(ids(r2.plans[0]).has(`plc_${far.id}`)).toBe(false);
    expect(sights(r2.plans[0])).toHaveLength(3);
  });

  it('긴 이동 줄이기: 더 가까운 곳이 없고 빼면 하루 최소 장소 수(2) 아래면 반영하지 않고, 바뀐 것이 없으면 다시 짜지 않음 (카카오를 더 부르지 않음)', async () => {
    const { first, revise, fake } = await setup({ count: 2, pace: [2, 2] });
    const A = first.plans[0];
    const before = { ...fake.calls };
    const out = await revise(first, [{ plan: 'A', type: 'move', placeId: sights(A)[1].placeId, toId: null }]);
    expect(out.results[0]).toMatchObject({ applied: false, note: 'A안 반영 못 함: 하루 최소 장소 수' });
    expect(out.changed).toEqual([]);
    expect(out.plans[0]).toBe(A);
    expect(out.states.A).toEqual(first.states.A);
    expect(fake.calls).toEqual(before);
  });

  it('바꿀 수 없는 곳은 앞서 반영한 수정까지 본 지금 안으로 확인: 사람이 남긴 곳(5단계)은 빼지 않고, 같은 꼭 지킬 것을 채우는 곳이 둘이면 하나는 빼도 되지만 남은 하나는 뺄 수 없음', async () => {
    const spa = (name: string, i: number, popularity: number) => near(name, i, { popularity, marks: { mem_1: [{ kind: 'must', label: '온천' }] } });
    const spa1 = spa('온천1', 0, 100);
    const spa2 = spa('온천2', 1, 95);
    const { first, revise } = await setup({ extra: [spa1, spa2], mustKeep: [include('온천')] });
    const A = first.plans[0];
    expect(ids(A).has(`plc_${spa1.id}`) && ids(A).has(`plc_${spa2.id}`)).toBe(true);
    const out = await revise(first, [
      { plan: 'A', type: 'avoid', placeId: `plc_${spa1.id}`, toId: null },
      { plan: 'A', type: 'avoid', placeId: `plc_${spa2.id}`, toId: null },
    ]);
    expect(out.results.map((r) => r.applied)).toEqual([true, false]);
    expect(out.results[1].note).toMatch(/바꿀 수 없는 곳/);
    expect(ids(out.plans[0]).has(`plc_${spa2.id}`)).toBe(true);

    const k = await setup({ keepFirst: true });
    const keptOne = `plc_${k.cands[0].id}`;
    expect(ids(k.first.plans[0]).has(keptOne)).toBe(true);
    const kept = await k.revise(k.first, [{ plan: 'A', type: 'avoid', placeId: keptOne, toId: null }]);
    expect(kept.results[0]).toMatchObject({ applied: false, note: expect.stringMatching(/바꿀 수 없는 곳/) });
    expect(kept.changed).toEqual([]);
  });

  it('안마다 한 라운드에 3개까지, 한 라운드에 같은 곳은 한 번만, 지금 그 안에 없는 곳(다른 안·이미 뺀 곳)은 반영 못 함', async () => {
    const { first, revise } = await setup({ count: 12 });
    const [A, B] = first.plans;
    const a = sights(A).map((s) => s.placeId);
    const onlyB = sights(B).map((s) => s.placeId).find((id) => !ids(A).has(id))!;
    const out = await revise(first, [
      { plan: 'A', type: 'avoid', placeId: 'plc_nope', toId: null },
      { plan: 'A', type: 'avoid', placeId: onlyB, toId: null },
      { plan: 'A', type: 'avoid', placeId: a[0], toId: null },
      { plan: 'A', type: 'replace', placeId: a[0], toId: onlyB },
      { plan: 'A', type: 'avoid', placeId: a[1], toId: null },
      { plan: 'A', type: 'avoid', placeId: a[2], toId: null },
      { plan: 'A', type: 'include', placeId: onlyB, toId: null },
    ]);
    expect(out.results.map((r) => r.note.replace(/^A안 /, ''))).toEqual([
      '반영 못 함: 지금 일정에 없는 곳',
      '반영 못 함: 지금 일정에 없는 곳',
      expect.stringMatching(/ 뺌/),
      '반영 못 함: 이번 라운드에 이미 바꾼 곳',
      expect.stringMatching(/ 뺌/),
      expect.stringMatching(/ 뺌/),
      '반영 못 함: 이번 라운드에 바꿀 수 있는 수를 다 씀',
    ]);
    expect(out.plans[0].changes).toHaveLength(3);
  });

  it('요청대로 넣은 곳은 다시 짤 때 이동 상한 고치기가 빼지 않음 (넣었다고 적고 사라지지 않게, 10/29 점검)', async () => {
    // 상한 20분: 먼 곳(약 13km)은 대중교통도 택시도 상한을 넘어 6단계의 이동 상한 고치기에 걸림 (가까운 곳끼리는 걷거나 택시로 안 넘음)
    const { far, first, revise } = await setup({ moveLimit: 20 });
    const out = await revise(first, [{ plan: 'A', type: 'include', placeId: `plc_${far.id}`, toId: null }]);
    expect(out.results[0]).toMatchObject({ applied: true, note: expect.stringMatching(/먼 곳 넣음/) });
    const A2 = out.plans[0];
    expect(ids(A2).has(`plc_${far.id}`)).toBe(true);
    // 먼 곳으로 가는 구간은 상한을 넘지만 빼지 않음 (다음 라운드에 AI가 긴 이동 줄이기를 요청할 수 있음)
    expect(A2.route[0].stops.some((x) => (x.moveFromPrev?.minutes ?? 0) > 20)).toBe(true);
    expect(A2.notes.some((n) => n.includes('먼 곳 뺌'))).toBe(false);
  });

  it('채우기는 다른 안에 있는 곳(같이 쓰는 곳 빼고)을 다른 곳이 없을 때만 씀: B안을 빼고 채워도 A안을 닮아 가지 않음 (10/19 결정, 10/29 점검)', async () => {
    const { first, revise } = await setup({ count: 14 });
    const [A, B] = first.plans;
    const shared = new Set(first.states.B.shared.map((id) => `plc_${id}`));
    const onlyB = sights(B).map((x) => x.placeId).filter((id) => !shared.has(id));
    const out = await revise(first, onlyB.slice(0, 2).map((placeId) => ({ plan: 'B' as const, type: 'avoid' as const, placeId, toId: null })));
    expect(out.results.every((r) => r.applied)).toBe(true);
    const overlap = (x: PlanProposal, y: PlanProposal) => [...ids(x)].filter((id) => ids(y).has(id) && !shared.has(id));
    expect(overlap(out.plans[1], A)).toEqual(overlap(B, A));
  });

  it('6단계 이동 상한 고치기로 뺀 곳은 9단계 채우기가 다시 넣지 않고, 사람이 남긴 곳은 이동 상한 고치기도 빼지 않음 (10/29 점검)', async () => {
    // 먼 곳(약 13km)을 AI 3명이 골라 점수가 가장 높아 6단계가 넣지만, 상한 20분을 대중교통·택시 모두 넘어 이동 상한 고치기로 뺌
    const db = await testDb();
    const farTop = cand('먼 인기곳', 35.24, 129.2, { popularity: 100 });
    const cands = [...Array.from({ length: 10 }, (_, i) => near(`관광지${i}`, i, { popularity: 80 - i * 5 })), farTop];
    const board = boardOf(cands, { [farTop.id]: { proposedBy: ['agt_1', 'agt_2', 'agt_3'] } });
    const members = [member('mem_1', { placesPerDay: [3, 3], maxMoveMinutes: 20 }), member('mem_2', { placesPerDay: [3, 3], maxMoveMinutes: 20 })];
    const input = (decision: ReviewDecision | null): ScheduleInput => ({ meetingId: 'mtg_test1', pool: poolOf(cands, ['2026-11-07']), board, members, decision, moveMode: 'transit' });
    const { router } = fakeRouter();
    const first = await schedulePlans(db, router, input(null));
    const A = first.plans[0];
    expect(A.notes.some((n) => n.includes('먼 인기곳 뺌'))).toBe(true);
    expect(ids(A).has(`plc_${farTop.id}`)).toBe(false);
    expect(first.states.A.banned).toContain(farTop.id);
    const out = await revisePlans(db, router, input(null), first, [{ plan: 'A', type: 'avoid', placeId: sights(A)[0].placeId, toId: null }], { changesPerPlan: 3 });
    expect(out.results[0].applied).toBe(true);
    expect(ids(out.plans[0]).has(`plc_${farTop.id}`)).toBe(false);
    // 같은 곳을 5단계에서 사람이 남겼으면 상한을 넘어도 빼지 않음 (7단계 표에 '바꿀 수 없음'으로 나오는 곳)
    const kept = await schedulePlans(db, router, input({ kept: [`plc_${farTop.id}`], dropped: [] } as unknown as ReviewDecision));
    expect(ids(kept.plans[0]).has(`plc_${farTop.id}`)).toBe(true);
  });

  it('넣기로 그날이 다 차면 AI가 덜 고른 곳부터 밀려남: AI가 고른 명소(좋아요 분류에는 안 잡힘)가 좋아요 분류에 잡힌 곳보다 먼저 빠지지 않음 (10/29 검증29)', async () => {
    const db = await testDb();
    const landmark = near('명소', 0, { popularity: 60 });
    const liked1 = near('좋아요1', 1, { popularity: 90, marks: { mem_1: [{ kind: 'like', label: '바다' }] } });
    const liked2 = near('좋아요2', 2, { popularity: 85, marks: { mem_2: [{ kind: 'like', label: '바다' }] } });
    const rest = Array.from({ length: 5 }, (_, i) => near(`관광지${i}`, 4 + i, { popularity: 5 }));
    const far = cand('먼 곳', 35.24, 129.2, { popularity: 0 });
    const cands = [landmark, liked1, liked2, ...rest, far];
    const board = boardOf(cands, { [landmark.id]: { proposedBy: ['agt_1'] } });
    const members = [member('mem_1', { placesPerDay: [3, 3] }), member('mem_2', { placesPerDay: [3, 3] })];
    const input: ScheduleInput = { meetingId: 'mtg_test1', pool: poolOf(cands, ['2026-11-07']), board, members, decision: null, moveMode: 'transit' };
    const { router } = fakeRouter();
    const first = await schedulePlans(db, router, input);
    const A = first.plans[0];
    expect([...ids(A)].sort()).toEqual([landmark, liked1, liked2].map((c) => `plc_${c.id}`).sort());
    const out = await revisePlans(db, router, input, first, [{ plan: 'A', type: 'include', placeId: `plc_${far.id}`, toId: null }], { changesPerPlan: 3 });
    expect(out.results[0].note).toBe('A안 1일째 먼 곳 넣음 (좋아요2 뺌)'); // AI가 고르지 않은 둘 중 점수가 낮은 곳
    expect(ids(out.plans[0]).has(`plc_${landmark.id}`)).toBe(true);
  });

  it('끼니 식당 빼기: 그 자리에 다른 식당을 넣고 이 안에서는 다시 쓰지 않음', async () => {
    const db = await testDb();
    await db.insert(places).values([
      restaurant('r1', '첫식당', 35.152, 129.1, { opentimefood: '10:00~22:00' }),
      restaurant('r2', '둘식당', 35.16, 129.105, { opentimefood: '10:00~22:00' }),
      restaurant('r3', '셋식당', 35.155, 129.11, { opentimefood: '10:00~22:00' }),
    ]);
    const cands = Array.from({ length: 8 }, (_, i) => near(`관광지${i}`, i, { popularity: 80 - i * 5 }));
    const members = [member('mem_1', { placesPerDay: [3, 3] }), member('mem_2', { placesPerDay: [3, 3] })];
    const input: ScheduleInput = { meetingId: 'mtg_test1', pool: poolOf(cands, ['2026-11-07']), board: boardOf(cands), members, decision: null, moveMode: 'transit' };
    const { router } = fakeRouter();
    const first = await schedulePlans(db, router, input);
    const lunch = first.plans[0].route[0].stops.find((s) => s.meal === 'lunch')!;
    const out = await revisePlans(db, router, input, first, [{ plan: 'A', type: 'avoid', placeId: lunch.placeId, toId: null }], { changesPerPlan: 3 });
    expect(out.results[0]).toMatchObject({ applied: true, note: `A안 1일째 ${lunch.name} 대신 다른 식당` });
    const foods = out.plans[0].route[0].stops.filter((s) => s.kind === 'food');
    expect(foods.length).toBe(first.plans[0].route[0].stops.filter((s) => s.kind === 'food').length);
    expect(foods.some((s) => s.placeId === lunch.placeId)).toBe(false);
    expect(out.states.A.banned).toContain(lunch.placeId.replace(/^plc_/, ''));
  });
});

/** 시뮬레이션용 고정 씨앗 난수 (mulberry32): 같은 씨앗이면 같은 경우를 다시 만듦 */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('9단계 수정 시뮬레이션 (무작위 여행·요청, 지켜야 할 규칙 확인)', { timeout: 600_000 }, () => {
  // CI는 적게, 이 PC에서는 SIM_N으로 늘려 돌림 (예: SIM_N=300)
  const N = Number(process.env.SIM_N ?? 12);
  it(`무작위 ${N}개 여행 × 최대 4라운드: 꼭 지킬 것·사람이 남긴 곳·숙소를 잃지 않고, 같은 곳이 두 번 들어가지 않으며, 안마다 라운드당 3개까지·바뀐 안만 version이 오름`, async () => {
    const problems: string[] = [];
    let applied = 0;
    let skipped = 0;
    for (let k = 0; k < N; k++) {
      const rnd = prng(1000 + k);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      const db = await testDb();
      const days = 1 + Math.floor(rnd() * 3);
      const dates = ['2026-11-07', '2026-11-08', '2026-11-09'].slice(0, days);
      const memberIds = ['mem_1', 'mem_2', 'mem_3', 'mem_4'].slice(0, 2 + Math.floor(rnd() * 3));
      const mustLabels = ['온천', '전망대', '시장'];
      const cands = Array.from({ length: 12 + Math.floor(rnd() * 25) }, (_, i) => {
        const marks: Record<string, { kind: 'like' | 'must'; label: string }[]> = {};
        for (const m of memberIds) {
          const mk: { kind: 'like' | 'must'; label: string }[] = [];
          if (rnd() < 0.25) mk.push({ kind: 'like', label: '바다' });
          if (rnd() < 0.06) mk.push({ kind: 'must', label: pick(mustLabels) });
          if (mk.length) marks[m] = mk;
        }
        const restDay = rnd() < 0.1 ? '매주 일요일' : null;
        return cand(`곳${i}`, 35.1 + rnd() * 0.12, 129.0 + rnd() * 0.15, { popularity: Math.floor(rnd() * 100), code: pick(['NA020900', 'VE010100', 'EX050100', 'HS010100']), rest: restDay, marks });
      });
      const restaurants = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => restaurant(`r${k}_${i}`, `식당${i}`, 35.1 + rnd() * 0.12, 129.0 + rnd() * 0.15, { opentimefood: '10:00~22:00' }));
      if (restaurants.length) await db.insert(places).values(restaurants);
      const members = memberIds.map((id) => {
        const rules = [...new Set(cands.flatMap((c) => (c.marks[id] ?? []).filter((x) => x.kind === 'must').map((x) => x.label)))];
        const pace: [number, number] = pick([[2, 3], [3, 4], [4, 5], [5, 6]] as [number, number][]);
        return member(id, { placesPerDay: pace, maxMoveMinutes: rnd() < 0.3 ? 30 : null }, [], rules.map(include));
      });
      const lodging = days > 1 ? [cand('호텔', 35.15, 129.07, { type: 32, code: 'AC010100' })] : [];
      const kept = cands.filter(() => rnd() < 0.08).map((c) => `plc_${c.id}`);
      const decision = { kept, dropped: [] } as unknown as ReviewDecision;
      const input: ScheduleInput = { meetingId: `mtg_sim${k}`, pool: poolOf(cands, dates, lodging), board: boardOf(cands), members, decision, moveMode: rnd() < 0.3 ? 'car' : 'transit' };
      const { router } = fakeRouter();
      let cur = await schedulePlans(db, router, input);
      const keyOf = (plan: PlanProposal) => new Set(plan.route.flatMap((d) => d.stops.flatMap((s) => Object.entries(cands.find((c) => `plc_${c.id}` === s.placeId)?.marks ?? {}).flatMap(([m, ks]) => ks.filter((x) => x.kind === 'must').map((x) => `${m}|${x.label}`)))));
      for (let round = 0; round < 4; round++) {
        const edits: PlanEdit[] = Array.from({ length: Math.floor(rnd() * 7) }, () => {
          const plan = pick(['A', 'B'] as const);
          const inPlan = cur.plans.find((p) => p.label === plan)!.route.flatMap((d) => d.stops.map((s) => s.placeId));
          const any = cands.map((c) => `plc_${c.id}`);
          const type = pick(['include', 'avoid', 'replace', 'move'] as const);
          const place = type === 'include' ? pick(any) : rnd() < 0.1 ? 'plc_nope' : pick(inPlan);
          return { plan, type, placeId: type === 'move' && rnd() < 0.2 ? null : place, toId: type === 'replace' ? pick(any) : null };
        });
        const before = cur;
        const out = await revisePlans(db, router, input, { plans: cur.plans, states: cur.states }, edits, { changesPerPlan: 3 });
        const limitMin = Math.min(...members.map((m) => m.profile.maxMoveMinutes ?? Infinity));
        // 요청대로 넣은 곳 (넣기의 곳·바꾸기의 바꿀 곳) — 그 곳 옆에서만 새 긴 이동·다른 안과 겹침이 생길 수 있음
        const requested = new Set(edits.flatMap((e, i) => (out.results[i].applied ? (e.type === 'include' ? [e.placeId] : e.type === 'replace' ? [e.toId] : []) : [])));
        const overLegs = (plan: PlanProposal) =>
          new Set(plan.route.flatMap((d) => d.stops.flatMap((s2, i2) => (i2 > 0 && (s2.moveFromPrev?.minutes ?? 0) > limitMin ? [[d.stops[i2 - 1].placeId, s2.placeId].sort().join('|')] : []))));
        const sharedB = new Set(cur.states.B.shared.map((id) => `plc_${id}`));
        const sightSet = (plan: PlanProposal) => new Set(plan.route.flatMap((d) => d.stops.filter((s2) => s2.kind === 'sight').map((s2) => s2.placeId)));
        const overlapOf = (x: PlanProposal, y: PlanProposal) => [...sightSet(x)].filter((id) => sightSet(y).has(id) && !sharedB.has(id));
        // 이번 라운드에 바뀐 곳(요청의 곳, 새로 들어온 곳, 빠진 곳 — 넣기에 밀려난 곳 포함)은 채우기에 쓰지 않으므로 남은 곳에서 뺌
        const changedIds = (x: PlanProposal, y: PlanProposal) => [...sightSet(x)].filter((id) => !sightSet(y).has(id));
        const touchedIds = new Set(
          [
            ...edits.flatMap((e) => [e.placeId, e.toId]),
            ...out.plans.flatMap((pl) => {
              const old = cur.plans.find((x) => x.label === pl.label)!;
              return [...changedIds(pl, old), ...changedIds(old, pl)];
            }),
          ].filter((x): x is string => !!x),
        );
        applied += out.results.filter((r) => r.applied).length;
        skipped += out.results.filter((r) => !r.applied).length;
        const tag = `여행 ${k} 라운드 ${round + 1}`;
        if (out.results.length !== edits.length) problems.push(`${tag}: 결과 수 ${out.results.length} ≠ 요청 수 ${edits.length}`);
        for (const l of ['A', 'B'] as const) {
          const was = before.plans.find((p) => p.label === l)!;
          const now = out.plans.find((p) => p.label === l)!;
          const n = out.results.filter((r) => r.plan === l && r.applied).length;
          if (n > 3) problems.push(`${tag} ${l}: 한 라운드에 ${n}개 반영`);
          if (now.planId !== was.planId) problems.push(`${tag} ${l}: planId 바뀜`);
          if (now.version !== was.version + (n > 0 ? 1 : 0)) problems.push(`${tag} ${l}: version ${was.version} → ${now.version} (반영 ${n})`);
          if (!n && now !== was) problems.push(`${tag} ${l}: 반영이 없는데 다시 짬`);
          // 꼭 지킬 것: 전에 채운 (사람·규칙)은 그대로 채움
          const lost = [...keyOf(was)].filter((x) => !keyOf(now).has(x));
          if (lost.length) problems.push(`${tag} ${l}: 꼭 지킬 것을 잃음 ${lost.join(', ')}`);
          // 사람이 남긴 곳은 안에 있었으면 그대로 있음
          const ids0 = new Set(was.route.flatMap((d) => d.stops.map((s) => s.placeId)));
          const ids1 = new Set(now.route.flatMap((d) => d.stops.map((s) => s.placeId)));
          for (const id of kept) if (ids0.has(id) && !ids1.has(id)) problems.push(`${tag} ${l}: 사람이 남긴 곳 ${id}를 뺌`);
          if (JSON.stringify(now.lodging) !== JSON.stringify(was.lodging)) problems.push(`${tag} ${l}: 숙소가 바뀜`);
          // 새로 생긴 긴 이동(가장 엄격한 상한 넘음)은 요청대로 넣은 곳 옆에서만. 끼니 식당 구간은 6단계도 이동 상한으로 빼지 않으므로(식당은 직선 거리로 고름) 보지 않음
          const foods = new Set(now.route.flatMap((d) => d.stops.filter((s2) => s2.kind !== 'sight').map((s2) => s2.placeId)));
          if (Number.isFinite(limitMin))
            for (const leg of overLegs(now))
              if (!overLegs(was).has(leg) && !leg.split('|').some((id) => requested.has(id) || foods.has(id))) problems.push(`${tag} ${l}: 요청 없이 새 긴 이동 ${leg}`);
          // 다른 안과 겹치는 곳(같이 쓰는 곳 빼고)은 요청대로 넣은 곳이거나, 채울 다른 곳이 남지 않았을 때만 늘어남 (6단계 pickSets의 reuse와 같은 잣대)
          const otherNow = out.plans.find((x) => x.label !== l)!;
          const otherWas = before.plans.find((x) => x.label !== l)!;
          const grew = overlapOf(now, otherNow).filter((id) => !overlapOf(was, otherWas).includes(id) && !requested.has(id) && sightSet(was).has(id) === false);
          const bannedL = new Set(out.states[l].banned.map((id) => `plc_${id}`));
          const freeLeft = cands.filter((c) => !c.rest && !sightSet(now).has(`plc_${c.id}`) && !sightSet(otherNow).has(`plc_${c.id}`) && !bannedL.has(`plc_${c.id}`) && !touchedIds.has(`plc_${c.id}`)).length;
          if (grew.length && freeLeft > 0) {
            problems.push(`${tag} ${l}: 채우기로 다른 안과 겹침 ${grew.join(',')} (남은 다른 곳 ${freeLeft})`);
            if (process.env.SIM_DEBUG)
              writeFileSync(`${process.env.SIM_DEBUG}/sim_${k}_${round + 1}_${l}.json`, JSON.stringify({ edits, results: out.results, before: before.plans.map((x) => [x.label, x.route.map((d) => d.stops.map((s2) => `${s2.kind}:${s2.name}`))]), after: out.plans.map((x) => [x.label, x.route.map((d) => d.stops.map((s2) => `${s2.kind}:${s2.name}`))]), free: cands.filter((c) => !c.rest && !sightSet(now).has(`plc_${c.id}`) && !sightSet(otherNow).has(`plc_${c.id}`) && !bannedL.has(`plc_${c.id}`) && !touchedIds.has(`plc_${c.id}`)).map((c) => c.name), names: Object.fromEntries(cands.map((c) => [`plc_${c.id}`, c.name])), shared: cur.states.B.shared, banned: out.states[l].banned }, null, 1));
          }
          // 같은 관광지가 안에 두 번 들어가지 않음 · 하루 관광지가 하루 최소 장소 수 아래로 내려가지 않음 (처음부터 적은 날은 빼고)
          const sightIds = now.route.flatMap((d) => d.stops.filter((s) => s.kind === 'sight').map((s) => s.placeId));
          if (new Set(sightIds).size !== sightIds.length) problems.push(`${tag} ${l}: 같은 관광지가 두 번`);
          now.route.forEach((d, i) => {
            const c = d.stops.filter((s) => s.kind === 'sight').length;
            const c0 = was.route[i].stops.filter((s) => s.kind === 'sight').length;
            if (c < SCHEDULE.perDayRange[0] && c < c0) problems.push(`${tag} ${l}: ${i + 1}일째 관광지 ${c0} → ${c}곳`);
          });
          // 뺀 곳(banned)은 넣기 요청 없이 다시 들어오지 않음
          const banned = new Set(out.states[l].banned.map((id) => `plc_${id}`));
          for (const s of now.route.flatMap((d) => d.stops)) if (banned.has(s.placeId)) problems.push(`${tag} ${l}: 뺀 곳 ${s.name}이 다시 들어옴`);
          // 저장한 재료(id)와 짠 안이 맞음: 날마다 넣은 관광지는 그날 일정에 있음 (이동 상한으로 뺀 곳은 재료에서도 빠짐)
          out.states[l].sets.forEach((ids, i) => {
            const stops = new Set(now.route[i].stops.map((s) => s.placeId));
            for (const id of ids) if (cands.some((c) => c.id === id) && !stops.has(`plc_${id}`)) problems.push(`${tag} ${l}: 재료의 ${id}가 ${i + 1}일째 일정에 없음`);
          });
        }
        cur = { plans: out.plans, extras: out.extras, states: out.states };
      }
    }
    expect(problems).toEqual([]);
    expect(applied).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });
});
