import { describe, expect, it } from 'vitest';
import { categories, places, regions, routeCache } from '../src/db/schema.js';
import type { MemberInput, Candidate, RetrieveResult } from '../src/meeting/retrieve.js';
import { ROUTE, type RouteClient, RouteUnavailable, cachedRouter, kakaoRouter, newRouteMeter, routeKey } from '../src/meeting/route.js';
import { SCHEDULE, type PlanProposal, duskKst, schedulePlans } from '../src/meeting/schedule.js';
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
  table: '',
  nights: dates.length - 1,
  lodgings,
  lodgingTable: '',
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
  schedulePlans(db, router, { meetingId: 'mtg_test1', pool, board, members, decision: o.decision ?? null, moveMode: o.moveMode ?? 'transit' });

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
