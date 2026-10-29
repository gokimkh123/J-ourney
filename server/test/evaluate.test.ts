import { describe, expect, it } from 'vitest';
import { EVAL, type EvalDraft, type PlanFacts, acceptEval, carryEval, evalRequest, ruleEval, satisfaction } from '../src/meeting/evaluate.js';
import type { Candidate, MemberInput, RetrieveResult } from '../src/meeting/retrieve.js';
import type { MoveLeg, PlanProposal, PlanStop } from '../src/meeting/schedule.js';
import type { Board, ReviewDecision } from '../src/meeting/types.js';

/** 계획 그림의 민지 예시: 좋아요 바다·카페, 싫어요 붐비는 곳·긴 이동(40분), 꼭 지킬 것 돼지국밥 */
const MINJI = 'mem_minji';
const minji: MemberInput = {
  memberId: MINJI,
  nickname: '민지',
  title: '바다 보는 여유파',
  likes: ['like_sea', 'like_cafe'],
  dislikes: ['dislike_crowd', 'dislike_longmove'],
  mustKeep: [{ type: 'include', label: '돼지국밥', quote: '돼지국밥은 꼭', keyword: '돼지국밥', target: 'food', start: null, end: null, amount: null }],
  profile: { placesPerDay: [3, 4], maxSteps: 12000, startTime: '09:00', endTime: '21:00', freeMinutes: 60, weights: { price: 0, crowd: 1, popularity: 0 }, maxMoveMinutes: 40, maxCrowd: 60, maxMealPrice: null, budgetPerPerson: null, avoidQueue: false, includes: [], avoids: [], likes: [] },
  wishes: ['바다 보면서 쉬고 싶어요'],
};

type MarkKind = 'like' | 'must' | 'crowd';
// 좌표는 실제 위치 근처 (기장 쪽 4곳과 멀리 떨어진 사하구 감천문화마을)
const place = (id: string, name: string, marks: [MarkKind, string][], [lat, lng]: [number, number]) =>
  ({ id, name, type: 12, category: '관광지', popularity: 50, crowd: null, hours: null, open: null, restUnknown: false, code: `AC${id}`, summary: '', menu: null, lat, lng, marks: { [MINJI]: marks.map(([kind, label]) => ({ kind, label })) } }) as unknown as Candidate;
const P = {
  temple: place('1', '해동용궁사', [['like', '바다']], [35.188, 129.223]),
  gukbap: place('2', '기장 돼지국밥집', [['must', '돼지국밥']], [35.244, 129.222]),
  park: place('3', '오랑대공원', [['like', '바다']], [35.171, 129.211]),
  gamcheon: place('4', '감천문화마을', [['crowd', '높음']], [35.097, 129.01]),
  cafe: place('5', '흰여울 바다카페', [['like', '카페']], [35.2, 129.225]),
  songjeong: place('6', '송정해수욕장', [['like', '바다']], [35.178, 129.2]),
  haenyeo: place('7', '기장 해녀촌', [['must', '돼지국밥']], [35.21, 129.23]),
};
const pool = { candidates: Object.values(P), lodgings: [] } as unknown as RetrieveResult;
const board: Board = { candidates: Object.values(P).map((c) => ({ placeId: `plc_${c.id}`, name: c.name, lat: 35.1, lng: 129.1, proposedBy: ['agt_x'], reactions: [] })), agenda: [] };

const leg = (minutes: number, mode: MoveLeg['mode'] = 'bus'): MoveLeg => ({ mode, minutes, distanceM: minutes * 300, fareWon: 1500, source: 'kakao_route', routeUrl: null, options: {} });
const stop = (c: Candidate, minutes: number | null, extra: Partial<PlanStop> = {}): PlanStop => ({
  itemId: `itm_${c.id}`,
  placeId: `plc_${c.id}`,
  name: c.name,
  lat: c.lat!,
  lng: c.lng!,
  kind: 'sight',
  category: c.category,
  meal: null,
  night: false,
  mustFor: c === P.gukbap ? [MINJI] : [],
  likedBy: [],
  moveFromPrev: minutes === null ? null : leg(minutes),
  ...extra,
});
const plan = (label: 'A' | 'B', stops: PlanStop[]): PlanProposal => ({
  planId: `pln_${label.toLowerCase()}`,
  version: 1,
  label,
  moveMode: 'transit',
  lodging: null,
  route: [{ day: 1, date: '2099-11-07', stops, summary: { moveMinutes: 0, unknownLegs: 0, spanMinutes: 600, heavy: false } }],
  notes: [],
});
// A: 해동용궁사 → 돼지국밥집(점심) → 오랑대 → 감천(67분, ⚠ 혼잡) → 바다카페 · B: 해동용궁사 → 돼지국밥집 → 바다카페 (25분 안)
const A = plan('A', [stop(P.temple, null), stop(P.gukbap, 21, { kind: 'food', meal: 'lunch' }), stop(P.park, 9), stop(P.gamcheon, 67), stop(P.cafe, 18)]);
const B = plan('B', [stop(P.temple, null), stop(P.gukbap, 21, { kind: 'food', meal: 'lunch' }), stop(P.cafe, 25)]);

const answer = (over: Partial<EvalDraft> = {}): EvalDraft => ({
  a: { why: '감천문화마을까지 이동이 너무 길어요', stance: '조건부' },
  b: { why: '바다·카페·돼지국밥이 다 있어요', stance: '찬성' },
  comment: '난 B가 좋아! A는 버스만 한참 타겠어',
  requests: [{ plan: 'A', type: 'replace', place: 'A4', to: 'C1', reason: '먼 곳 대신 가까운 바다' }],
  ...over,
});
const setup = (decision: ReviewDecision | null = null) => evalRequest(minji, [A, B], pool, board, decision);

describe('7단계 평가: 사실표·만족도 (코드 계산)', () => {
  it('일정안 표는 번호|장소|분류|오는 길|내 조건이고, 사실은 기준마다 안·넘음과 꼭 지킬 것 지킴을 코드가 적음', () => {
    const { req, facts } = setup();
    const rows = req.input.plans.A.split('\n');
    expect(rows[0]).toBe('번호|장소|분류|오는 길|내 조건');
    expect(rows[2]).toBe('A2|기장 돼지국밥집 (점심·바꿀 수 없음)|관광지|버스 21분|👍 꼭 지킬 것: 돼지국밥'); // 꼭 지킬 곳은 못 바꾸는 곳으로 표시
    expect(rows[1]).toMatch(/^A1\|해동용궁사\|/);
    expect(rows[4]).toMatch(/^A4\|감천문화마을\|관광지\|버스 67분\|⚠ 혼잡 예측 높음/);
    expect(req.input.facts.A.기준[0]).toBe('가장 긴 이동 67분 (오랑대공원 → 감천문화마을, 내 기준 40분 넘음)');
    expect(req.input.facts.B.기준[0]).toMatch(/내 기준 40분 안\)$/);
    expect(req.input.facts.A.꼭지킬것).toEqual(['돼지국밥: 지킴']);
    expect(req.input.candidates.split('\n')[1]).toMatch(/^C1\|송정해수욕장\|/); // 두 안에 없는 후보만 C 번호
    expect(facts[0]).toMatchObject({ liked: 4, warned: 1, musts: [{ kept: true }], limit: { minutes: 40, over: true, rule: false }, longest: { minutes: 67, fixed: false } });
  });

  it('6단계 안 메모(이미 뺀 곳의 이동 등)는 AI 입력에 넣지 않음 (그 안의 이동으로 잘못 읽지 않게)', () => {
    const noted = { ...B, notes: ['1일째 아이리 뺌 — 영진돼지국밥 → 아이리 이동 97분 (가장 엄격한 한 번 이동 상한 40분)'] };
    const { req } = evalRequest(minji, [A, noted], pool, board, null);
    expect(Object.keys(req.input.facts.B)).toEqual(['기준', '꼭지킬것', '이동많은날']);
    expect(JSON.stringify(req.input)).not.toContain('97분');
  });

  it('만족도 = 기본 6 + 👍(최대 2) + 꼭 지킬 것 + 기준 넘음 + ⚠ + 입장 (A 조건부 7점, B 찬성 10점)', () => {
    const { facts } = setup();
    expect(satisfaction(facts[0], '조건부')).toBe(6 + 2 + 1 - 1 - 1 + 0);
    expect(satisfaction(facts[1], '찬성')).toBe(6 + 2 + 1 + 1); // 👍 3곳이라도 +2까지
    const bad: PlanFacts = { plan: 'A', liked: 0, warned: 3, musts: [{ rule: 0, kept: false }, { rule: 1, kept: false }], longest: { minutes: 90, from: 'x', to: 'y', fixed: false, out: 'y' }, limit: { minutes: 40, over: true, rule: true }, heavyDays: [] };
    expect(satisfaction(bad, '반대')).toBe(EVAL.satisfaction.min); // 0 아래로 내려가지 않음
  });

  it('긴 이동의 한쪽이 숙소·꼭 지킬 곳·사람이 남긴 곳이면 바꿀 수 없음으로 적고, 찬성을 막지 않음', () => {
    const kept: ReviewDecision = { kept: ['plc_4'], dropped: [], votes: [], responded: [], defaulted: [], closedBy: 'all' };
    const { req, facts } = setup(kept);
    expect(req.input.facts.A.기준[0]).toMatch(/넘지만 .*바꿀 수 없음\)$/);
    expect(req.input.plans.A.split('\n')[4]).toMatch(/^A4\|감천문화마을 \(바꿀 수 없음\)\|/); // 사람이 남긴 곳
    expect(facts[0].longest?.fixed).toBe(true);
    const out = acceptEval(minji, [A, B], ...(() => { const s = setup(kept); return [s.table, s.facts] as const; })(), answer({ a: { why: '좋아요', stance: '찬성' }, requests: [] }));
    expect(out.plans[0].stance).toBe('찬성');
    expect(out.fixes).toEqual([]);
  });
});

describe('7단계 평가: 사실표 세부 (10/28 점검)', () => {
  it('6단계가 DB에서 보충한 식당의 꼭 지킬 것 표시도 봄 (안 보면 그 안의 꼭 지킬 것을 못 지킴으로 셈)', () => {
    const extra = place('8', '수변최고돼지국밥', [['must', '돼지국밥']], [35.2, 129.21]);
    const withDb = plan('B', [stop(P.temple, null), stop(extra, 15, { kind: 'food', meal: 'lunch', mustFor: [MINJI] }), stop(P.cafe, 25)]);
    expect(evalRequest(minji, [A, withDb], pool, board, null).req.input.facts.B.꼭지킬것).toEqual(['돼지국밥: 못 지킴']);
    const { req } = evalRequest(minji, [A, withDb], { ...pool, candidates: [...pool.candidates, extra] }, board, null);
    expect(req.input.facts.B.꼭지킬것).toEqual(['돼지국밥: 지킴']);
    expect(req.input.plans.B.split('\n')[2]).toMatch(/^B2\|수변최고돼지국밥 \(점심·바꿀 수 없음\)\|.*👍 꼭 지킬 것: 돼지국밥$/);
  });

  it('같은 꼭 지킬 것을 채우는 곳이 한 안에 여럿이면 그중 어느 곳도 못 바꾸는 곳이 아님 (하나뿐일 때만 바꿀 수 없음)', () => {
    const two = plan('B', [stop(P.temple, null), stop(P.gukbap, 21, { kind: 'food', meal: 'lunch' }), stop(P.haenyeo, 10, { mustFor: [MINJI] }), stop(P.cafe, 25)]);
    const { req } = evalRequest(minji, [A, two], pool, board, null);
    const rows = req.input.plans.B.split('\n');
    expect(rows[2]).not.toMatch(/바꿀 수 없음/);
    expect(rows[3]).not.toMatch(/바꿀 수 없음/);
    expect(req.input.plans.A.split('\n')[2]).toMatch(/바꿀 수 없음/); // A에는 돼지국밥집 하나뿐
  });

  it('긴 이동은 6단계와 같은 잣대: 다른 곳들에서 더 먼 쪽이 숙소면 바꿀 수 없음, 관광지면 그곳을 빼면 됨 · 기준을 넘는 바꿀 수 있는 구간이 더 긴 못 바꾸는 구간 뒤에 가려지지 않음', () => {
    const hotel = place('9', '감천 게스트하우스', [], [35.098, 129.011]);
    const far = (minutes: number[]) =>
      plan('B', [stop(P.temple, null), stop(P.park, minutes[0]), stop(P.cafe, minutes[1]), stop(hotel, minutes[2], { kind: 'lodging' })]);
    // 바다카페 → 숙소 70분: 먼 쪽이 숙소 → 바꿀 수 없음
    const fixed = evalRequest(minji, [A, far([10, 10, 70])], pool, board, null);
    expect(fixed.facts[1].longest).toMatchObject({ minutes: 70, fixed: true, out: null });
    expect(fixed.req.input.facts.B.기준[0]).toMatch(/넘지만 .*바꿀 수 없음\)$/);
    // 해동용궁사 → 오랑대 45분(바꿀 수 있음, 먼 쪽 오랑대)이 숙소 80분 뒤에 가려지지 않음
    const hidden = evalRequest(minji, [A, far([45, 10, 80])], pool, board, null);
    expect(hidden.facts[1].longest).toMatchObject({ minutes: 45, fixed: false, out: 'plc_3' });
    expect(hidden.req.input.facts.B.기준[0]).toBe('가장 긴 이동 45분 (해동용궁사 → 오랑대공원, 내 기준 40분 넘음)');
    // A안: 오랑대 → 감천 67분은 먼 쪽 감천을 빼면 되므로 바꿀 수 있음
    expect(fixed.facts[0].longest).toMatchObject({ minutes: 67, fixed: false, out: 'plc_4' });
  });

  it('👍·⚠는 같은 곳을 한 번만 셈 (숙소는 날마다 나오고 들어감)', () => {
    const inn = place('10', '바다 호텔', [['like', '바다']], [35.19, 129.22]);
    const twoDays: PlanProposal = {
      ...plan('B', []),
      lodging: { placeId: 'plc_10', name: '바다 호텔' },
      route: [
        { day: 1, date: '2099-11-07', stops: [stop(P.temple, null), stop(P.cafe, 10), stop(inn, 10, { kind: 'lodging' })], summary: { moveMinutes: 20, unknownLegs: 0, spanMinutes: 600, heavy: false } },
        { day: 2, date: '2099-11-08', stops: [stop(inn, null, { kind: 'lodging' }), stop(P.park, 10)], summary: { moveMinutes: 10, unknownLegs: 0, spanMinutes: 600, heavy: false } },
      ],
    };
    const lodged = { ...pool, lodgings: [inn] } as unknown as RetrieveResult;
    const { facts } = evalRequest(minji, [A, twoDays], lodged, board, null);
    expect(facts[1].liked).toBe(4); // 해동용궁사·바다카페·바다 호텔·오랑대 (호텔 두 줄은 한 곳)
  });

  it('보일 수 없는 요청 이유는 요청 종류마다 정한 코드 문장으로 바꾸고, 상한에 잘린 요청은 고친 것으로 세지 않음', () => {
    const { table, facts } = setup();
    const long = '이 곳은 사람이 너무 많을 것 같아서 다른 조용한 곳으로 바꾸면 좋겠어요';
    const out = acceptEval(minji, [A, B], table, facts, answer({
      requests: [
        { plan: 'A', type: 'replace', place: 'A4', to: 'C1', reason: long },
        { plan: 'A', type: 'avoid', place: 'A3', to: '-', reason: '오랑대는 빼요' },
        { plan: 'A', type: 'include', place: 'C2', to: '-', reason: long },
      ],
    }));
    expect(out.requests.map((r) => r.reason)).toEqual(['후보로 바꾸기', '오랑대는 빼요']);
    expect(out.fixes.filter((f) => f.kind === 'reason')).toEqual([{ kind: 'reason', plan: 'A' }]);
  });
});

describe('7단계 평가: 답 형식표 (고른 값은 보기 안에서만)', () => {
  it('입장·요청 종류·표 번호는 보기 밖의 값을 받지 않음 (형식 오류 → 1번 더 → 규칙 평가)', () => {
    const { req } = setup();
    expect(req.schema.safeParse(answer()).success).toBe(true);
    expect(req.schema.safeParse(answer({ a: { why: '좋아요', stance: '약간 찬성' } })).success).toBe(false);
    expect(req.schema.safeParse(answer({ requests: [{ plan: 'A', type: 'steps', place: '-', to: '-', reason: '' }] as never })).success).toBe(false);
    expect(req.schema.safeParse(answer({ requests: [{ plan: 'A', type: 'avoid', place: 'A9', to: '-', reason: '' }] })).success).toBe(false); // 표에 없는 번호
    expect(req.schema.safeParse(answer({ requests: [{ plan: 'A', type: 'replace', place: 'A4', to: 'A1', reason: '' }] })).success).toBe(false); // to는 후보 번호만
  });
});

describe('7단계 평가: 코드 확인 (AI 글은 읽지 않고 고른 값과 사실표만 봄)', () => {
  const accept = (draft: EvalDraft, decision: ReviewDecision | null = null) => {
    const { table, facts } = setup(decision);
    return acceptEval(minji, [A, B], table, facts, draft);
  };

  it('그림 예시: 조건부 요청 A4 → C1을 받고 만족도를 코드가 계산함 (고친 것 없음)', () => {
    const out = accept(answer());
    expect(out.plans.map((p) => [p.plan, p.stance, p.score])).toEqual([['A', '조건부', 7], ['B', '찬성', 10]]);
    expect(out.requests).toEqual([{ plan: 'A', type: 'replace', placeId: 'plc_4', toId: 'plc_6', reason: '먼 곳 대신 가까운 바다', auto: false }]);
    expect(out.fixes).toEqual([]);
  });

  it('④ 바꿀 수 있는 기준 넘음인데 찬성 → 조건부, ⑤ 요청이 없으면 규칙 요청(긴 이동 줄이기)', () => {
    const out = accept(answer({ a: { why: '좋아요', stance: '찬성' }, requests: [] }));
    expect(out.plans[0]).toMatchObject({ stance: '조건부', score: 7 });
    // ⚠ 곳(감천) 빼기가 긴 이동보다 앞
    expect(out.requests).toEqual([{ plan: 'A', type: 'avoid', placeId: 'plc_4', toId: null, reason: '내 조건에 걸리는 곳', auto: true }]);
    expect(out.fixes).toEqual([{ kind: 'stance', plan: 'A' }, { kind: 'rule_request', plan: 'A' }]);
  });

  it('② 번호 종류가 틀린 요청(include에 일정 번호, B안 요청에 A 번호)은 버림 · ③ 꼭 지킬 곳·사람이 남긴 곳을 빼자는 요청은 버림', () => {
    const kept: ReviewDecision = { kept: ['plc_3'], dropped: [], votes: [], responded: [], defaulted: [], closedBy: 'all' };
    const out = accept(
      answer({
        requests: [
          { plan: 'A', type: 'include', place: 'A1', to: '-', reason: '넣기' },
          { plan: 'B', type: 'avoid', place: 'A4', to: '-', reason: '빼기' },
          { plan: 'A', type: 'avoid', place: 'A2', to: '-', reason: '국밥 빼기' },
          { plan: 'A', type: 'avoid', place: 'A3', to: '-', reason: '공원 빼기' },
        ],
      }),
      kept,
    );
    expect(out.fixes.filter((f) => f.kind === 'code')).toHaveLength(2);
    expect(out.fixes.filter((f) => f.kind === 'protected')).toHaveLength(2);
    expect(out.requests.every((r) => r.auto)).toBe(true); // 남은 것이 없어 규칙 요청만
  });

  it('요청 수: AI 요청은 최대 수까지, 그 뒤 요청이 없는 조건부 안에는 규칙 요청이 붙음 (B 3개 + A 조건부 → A 요청도 남음)', () => {
    const out = accept(
      answer({
        b: { why: '좀 아쉬워요', stance: '조건부' },
        requests: [
          { plan: 'B', type: 'avoid', place: 'B1', to: '-', reason: '빼기' },
          { plan: 'B', type: 'replace', place: 'B3', to: 'C1', reason: '바다로' },
          { plan: 'B', type: 'include', place: 'C2', to: '-', reason: '넣기' },
        ],
      }),
    );
    expect(out.requests.filter((r) => r.plan === 'B' && !r.auto)).toHaveLength(EVAL.requestsPerMember);
    expect(out.requests.filter((r) => r.plan === 'A')).toEqual([{ plan: 'A', type: 'avoid', placeId: 'plc_4', toId: null, reason: '내 조건에 걸리는 곳', auto: true }]);
    expect(out.fixes).toContainEqual({ kind: 'rule_request', plan: 'A' });
  });

  it('⑥ 보이는 글: 이 회의의 번호는 장소 이름으로, 칸 이름이 나오거나 너무 길면 사실표로 만든 규칙 문장', () => {
    const out = accept(answer({ a: { why: 'A4까지 너무 멀어요', stance: '조건부' }, b: { why: 'facts가 좋아요', stance: '찬성' }, comment: '가'.repeat(EVAL.commentHardMax + 1) }));
    expect(out.plans[0].why).toBe('감천문화마을까지 너무 멀어요');
    expect(out.plans[1].why).toBe('좋아하는 곳이 3곳 있어요');
    expect(out.comment).toBe('저는 B안이 더 좋아요');
    expect(out.fixes).toEqual([{ kind: 'why', plan: 'B' }, { kind: 'comment', plan: null }]);
  });

  it('입장은 why 글과 상관없이 고른 값으로만 정함 (글은 판단에 쓰지 않음)', () => {
    const same = accept(answer({ b: { why: '이동이 너무 길어요', stance: '찬성' } }));
    expect(same.plans[1]).toMatchObject({ stance: '찬성', score: 10, why: '이동이 너무 길어요' });
  });

  it('규칙 평가 (LLM 없음·상한·형식 2번 틀림): 사실표 점수로 입장, 찬성할 수 없는 안은 조건부 이하 + 규칙 요청', () => {
    const { table, facts } = setup();
    const out = ruleEval(minji, [A, B], table, facts, 7);
    expect(out.source).toBe('rule');
    expect(out.plans.map((p) => p.stance)).toEqual(['조건부', '찬성']);
    expect(out.requests).toHaveLength(1);
    expect(out.requests[0]).toMatchObject({ plan: 'A', type: 'avoid', auto: true });
  });
});

describe('11단계: 사회자가 다시 부르지 않은 사람 (지난 평가를 그대로, LLM 0회)', () => {
  it('입장·한마디는 그대로 두고 만족도는 바뀐 일정의 사실표로 다시 계산, 찬성할 수 없게 바뀐 안은 조건부 + 규칙 요청, 바뀐 안의 이유는 규칙 문장', () => {
    const { table, facts } = setup();
    const prev = acceptEval(minji, [A, B], table, facts, answer());
    expect(prev.plans.map((v) => v.stance)).toEqual(['조건부', '찬성']);
    // B안 v2: 감천문화마을(⚠ 혼잡)이 67분 걸려 들어옴 → 이동 기준(40분) 넘음
    const B2: PlanProposal = { ...B, version: 2, route: [{ ...B.route[0], stops: [...B.route[0].stops, stop(P.gamcheon, 67)] }] };
    const next = evalRequest(minji, [A, B2], pool, board, null);
    const carried = carryEval(minji, prev, [A, B2], next.table, next.facts, new Set(['B'] as const));
    expect(carried).toMatchObject({ carried: true, llmCalls: 0, recorded: false, comment: prev.comment });
    expect(carried.plans[0]).toMatchObject({ plan: 'A', stance: '조건부', why: prev.plans[0].why, score: prev.plans[0].score });
    expect(carried.plans[1]).toMatchObject({ plan: 'B', stance: '조건부', score: satisfaction(next.facts[1], '조건부') });
    expect(carried.plans[1].why).not.toBe(prev.plans[1].why);
    expect(carried.fixes).toEqual([
      { kind: 'stance', plan: 'B' },
      { kind: 'rule_request', plan: 'B' },
    ]);
    // A안(바뀌지 않음)의 요청은 남고, B안에는 규칙 요청 (⚠ 곳 빼기)
    expect(carried.requests.map((r) => [r.plan, r.type, r.auto])).toEqual([
      ['A', 'replace', false],
      ['B', 'avoid', true],
    ]);
  });
});

describe('검증29 뒤 고침 (10/29)', () => {
  it("'바꿀 수 없음' 곳을 가리킨 요청: 빼기·바꾸기는 버리고, 긴 이동 줄이기는 그 안에서 줄일 수 있는 가장 긴 이동으로 바꿈 (답 형식은 그대로라 형식 오류 없음)", () => {
    const { req, table, facts } = setup();
    expect(table.rows.get('A2')).toMatchObject({ name: '기장 돼지국밥집', fixed: true }); // 이 안에서 돼지국밥을 채우는 곳은 하나뿐
    const draft = answer({
      requests: [
        { plan: 'A', type: 'avoid', place: 'A2', to: '-', reason: '빼 주세요' },
        { plan: 'A', type: 'move', place: 'A2', to: '-', reason: '이동이 길어요' },
      ],
    });
    expect(req.schema.safeParse(draft).success).toBe(true);
    const e = acceptEval(minji, [A, B], table, facts, draft);
    expect(e.requests).toEqual([expect.objectContaining({ plan: 'A', type: 'move', placeId: null, auto: false })]);
    expect(e.fixes).toEqual(expect.arrayContaining([{ kind: 'protected', plan: 'A' }, { kind: 'move_auto', plan: 'A' }]));
    expect(facts[0].longest).toMatchObject({ fixed: false, out: 'plc_4' }); // 9단계가 이 사실표로 감천문화마을 쪽 긴 이동을 줄임
  });

  it("2라운드부터 지난 수정으로 새로 들어온 곳에 '(새로 들어옴)', 사실 칸에 안마다 '바뀜'·'그대로'를 코드가 적음 (1라운드 입력은 그대로)", () => {
    const first = evalRequest(minji, [A, B], pool, board, null);
    expect(JSON.stringify(first.req.input)).not.toContain('새로 들어옴');
    expect(first.req.input.facts.A).not.toHaveProperty('지난라운드뒤');
    const next = evalRequest(minji, [A, B], pool, board, null, { round: 2, changes: ['A안 1일째 오랑대공원 넣음'], diff: { A: { added: ['plc_3'], removed: ['plc_9'] }, B: { added: [], removed: [] } } });
    expect(next.req.input.plans.A.split('\n').find((l: string) => l.startsWith('A3|'))).toMatch(/^A3\|오랑대공원 \(새로 들어옴\)\|/);
    expect(next.req.input.facts.A.지난라운드뒤).toBe('바뀜 (새로 들어옴 1곳 · 빠짐 1곳)');
    expect(next.req.input.facts.B.지난라운드뒤).toBe('그대로');
  });
});
