import { describe, expect, it } from 'vitest';
import type { EvalRequest, EvalRound, MemberEval, PlanFacts, Stance } from '../src/meeting/evaluate.js';
import { MEETING_NODES, MEETING_STEP_LIMIT } from '../src/meeting/graph.js';
import { MEETING_RULES, type PolishSnapshot, ROUNDS, decide, editKey, hurtBy, planDiff, requestsFor, revertPolish, speakersOf, tallyOf } from '../src/meeting/rounds.js';
import type { PlanProposal, PlanStates } from '../src/meeting/schedule.js';

const stopOf = (placeId: string, o: { mustFor?: string[]; likedBy?: string[] } = {}) => ({
  itemId: `itm_${placeId}`,
  placeId,
  name: placeId,
  lat: 35.1,
  lng: 129.1,
  kind: 'sight' as const,
  category: null,
  meal: null,
  night: false,
  mustFor: o.mustFor ?? [],
  likedBy: o.likedBy ?? [],
  moveFromPrev: null,
});
const planOf = (label: 'A' | 'B', version: number, stops = [stopOf(`plc_${label}1`), stopOf(`plc_${label}2`)]): PlanProposal => ({
  planId: `pln_${label.toLowerCase()}`,
  version,
  label,
  moveMode: 'transit',
  lodging: null,
  route: [{ day: 1, date: '2099-11-07', stops, summary: { moveMinutes: 0, unknownLegs: 0, spanMinutes: 600, heavy: false } }],
  notes: [],
});
const factsOf = (plan: 'A' | 'B', out: string | null = null): PlanFacts => ({
  plan,
  liked: 0,
  warned: 0,
  musts: [],
  longest: out ? { minutes: 70, from: 'plc_x', to: out, fixed: false, out } : null,
  limit: null,
  heavyDays: [],
});
const req = (plan: 'A' | 'B', type: EvalRequest['type'], placeId: string | null, toId: string | null = null): EvalRequest => ({ plan, type, placeId, toId, reason: '', auto: false });
/** 한 사람의 평가: [A 입장, A 점수], [B 입장, B 점수] */
const evalOf = (memberId: string, a: [Stance, number], b: [Stance, number], requests: EvalRequest[] = [], out: string | null = null): MemberEval => ({
  memberId,
  agentId: memberId.replace(/^mem_/, 'agt_'),
  source: 'llm',
  llmCalls: 1,
  recorded: false,
  plans: [
    { plan: 'A', planId: 'pln_a', stance: a[0], why: '', score: a[1] },
    { plan: 'B', planId: 'pln_b', stance: b[0], why: '', score: b[1] },
  ],
  comment: '',
  requests,
  fixes: [],
  facts: [factsOf('A', out), factsOf('B')],
});
const roundOf = (members: MemberEval[], round = 1): EvalRound => ({ round, members });
const plans = [planOf('A', 1), planOf('B', 1)];
const members = ['mem_1', 'mem_2', 'mem_3', 'mem_4'].map((memberId) => ({ memberId }) as never);

describe('8·12단계 집계 (평균만 봄, 10/26 사용자 결정)', () => {
  it('평균 ≥ 기준이면 통과: 9·9·9·3 = 7.5 통과 (가장 낮은 사람 조건 없음), 8·8·5·6 = 6.75 통과 못 함', () => {
    const ev = roundOf([
      evalOf('mem_1', ['찬성', 9], ['찬성', 8]),
      evalOf('mem_2', ['찬성', 9], ['찬성', 8]),
      evalOf('mem_3', ['찬성', 9], ['조건부', 5]),
      evalOf('mem_4', ['반대', 3], ['조건부', 6]),
    ]);
    const [a, b] = tallyOf(ev, plans, 7);
    expect(a).toMatchObject({ plan: 'A', average: 7.5, passed: true });
    expect(b).toMatchObject({ plan: 'B', average: 6.75, passed: false });
  });

  it('다음 일: 둘 다 통과면 끝(passed), 다듬을 요청이 남으면 1번 다듬기 (마지막 라운드면 안 함)', () => {
    const pass = [
      { plan: 'A' as const, planId: 'pln_a', version: 1, average: 8, passed: true },
      { plan: 'B' as const, planId: 'pln_b', version: 1, average: 7, passed: true },
    ];
    expect(decide(null, pass, 1, 5, false)).toMatchObject({ next: 'end', outcome: 'passed' });
    expect(decide(null, pass, 1, 5, true)).toMatchObject({ next: 'polish', outcome: null });
    expect(decide(null, pass, 5, 5, true)).toMatchObject({ next: 'end', outcome: 'passed' });
  });

  it('다음 일: 통과 못 한 안이 있으면 수정, 마지막 라운드면 끝(max_rounds), 평균이 연속으로 오르지 않으면 끝(stalled)', () => {
    const fail = (a: number) => [
      { plan: 'A' as const, planId: 'pln_a', version: 1, average: a, passed: false },
      { plan: 'B' as const, planId: 'pln_b', version: 1, average: 8, passed: true },
    ];
    const r1 = decide(null, fail(5), 1, 5, false);
    expect(r1).toMatchObject({ next: 'revise', stalls: 0, best: { A: 5 } });
    expect(decide(r1, fail(6), 5, 5, false)).toMatchObject({ next: 'end', outcome: 'max_rounds' });
    // 오름 → 같음(1번째 정체) → 내려감(2번째 정체) → 멈춤
    const r2 = decide(r1, fail(6), 2, 5, false);
    expect(r2).toMatchObject({ next: 'revise', stalls: 0, best: { A: 6 } });
    const r3 = decide(r2, fail(6), 3, 5, false);
    expect(r3).toMatchObject({ next: 'revise', stalls: 1 });
    expect(decide(r3, fail(5.5), 4, 5, false)).toMatchObject({ next: 'end', outcome: 'stalled' });
    expect(ROUNDS.noProgressRounds).toBe(2);
  });

  it('나아짐은 통과 못 한 동안의 가장 좋은 값과 비교: 통과(8.0)했다가 떨어진(6.0) 안이 다시 오르면(6.5) 정체가 아님 (10/29 점검)', () => {
    const t = (a: number, passed: boolean) => [
      { plan: 'A' as const, planId: 'pln_a', version: 1, average: a, passed },
      { plan: 'B' as const, planId: 'pln_b', version: 1, average: 5, passed: false },
    ];
    const r1 = decide(null, t(8, true), 1, 5, false); // B만 통과 못 함
    const r2 = decide(r1, t(6, false), 2, 5, false); // A가 떨어짐 (B는 그대로 5)
    expect(r2).toMatchObject({ next: 'revise', stalls: 0 });
    const r3 = decide(r2, t(6.5, false), 3, 5, false);
    expect(r3).toMatchObject({ next: 'revise', stalls: 0, best: { A: 6.5 } });
  });

  it('실행 한 번의 노드 수 상한은 사람 확인 없이 최대 라운드까지 가는 가장 긴 길보다 여유 있게 큼 (24걸음 → LangGraph 기본 25는 노드 하나만 더해도 실패)', () => {
    // 1라운드까지: 준비·후보 찾기·고르기·보드·반응·동선·평가·집계 (사람 확인·수정·사회자 뺌) + 라운드마다 수정·사회자·평가·집계
    const firstRound = MEETING_NODES.filter((n) => !['review', 'revise', 'moderate'].includes(n.id)).length;
    const longest = firstRound + ROUNDS.nodesPerRound * (MEETING_RULES.maxRounds.max - 1);
    expect(longest).toBe(24);
    expect(MEETING_STEP_LIMIT).toBeGreaterThanOrEqual(longest + ROUNDS.stepsMargin);
  });
});

describe('9단계에 넘길 요청 (순서·거르기)', () => {
  it('통과 못 한 안의 요청만, 그 안의 만족도가 낮은 사람부터, 같은 요청은 한 번, 이미 반영한 요청은 다시 하지 않음', () => {
    const ev = roundOf([
      evalOf('mem_1', ['조건부', 6], ['찬성', 8], [req('A', 'avoid', 'plc_A1'), req('B', 'avoid', 'plc_B1')]),
      evalOf('mem_2', ['반대', 4], ['찬성', 8], [req('A', 'replace', 'plc_A2', 'plc_C1'), req('A', 'avoid', 'plc_A1')]),
      evalOf('mem_3', ['조건부', 6], ['찬성', 8], [req('A', 'include', 'plc_C2')]),
      evalOf('mem_4', ['찬성', 9], ['찬성', 9]),
    ]);
    const t = tallyOf(ev, plans, 7);
    expect(t.map((x) => x.passed)).toEqual([false, true]);
    const got = requestsFor('revise', ev, t, new Set());
    // mem_2(4점) → mem_1(6점, 자리 앞) → mem_3(6점). mem_1의 A1 빼기는 mem_2가 먼저 낸 같은 요청이라 한 번만, B안(통과) 요청은 빠짐
    expect(got.map((e) => [e.by, e.type, e.placeId])).toEqual([
      ['mem_2', 'replace', 'plc_A2'],
      ['mem_2', 'avoid', 'plc_A1'],
      ['mem_3', 'include', 'plc_C2'],
    ]);
    const tried = new Set([editKey({ plan: 'A', type: 'replace', placeId: 'plc_A2', toId: 'plc_C1' })]);
    expect(requestsFor('revise', ev, t, tried).map((e) => e.type)).toEqual(['avoid', 'include']);
  });

  it('긴 이동 줄이기의 뺄 곳이 비어 있으면 그 사람 사실표의 가장 긴 바꿀 수 있는 이동에서 뺄 곳을 씀', () => {
    const ev = roundOf([evalOf('mem_1', ['조건부', 5], ['찬성', 8], [req('A', 'move', null)], 'plc_A2')]);
    expect(requestsFor('revise', ev, tallyOf(ev, plans, 7), new Set())[0]).toMatchObject({ type: 'move', placeId: 'plc_A2' });
  });

  it('다듬기: 둘 다 통과했을 때 통과한 안에 조건부·반대를 낸 사람의 그 안 요청만 (찬성한 사람의 요청은 다듬지 않음)', () => {
    const ev = roundOf([
      evalOf('mem_1', ['조건부', 7], ['찬성', 8], [req('A', 'avoid', 'plc_A1')]),
      evalOf('mem_2', ['찬성', 9], ['찬성', 8], [req('A', 'include', 'plc_C1')]),
    ]);
    const t = tallyOf(ev, plans, 7);
    expect(t.every((x) => x.passed)).toBe(true);
    expect(requestsFor('polish', ev, t, new Set()).map((e) => [e.by, e.type])).toEqual([['mem_1', 'avoid']]);
    expect(requestsFor('revise', ev, t, new Set())).toEqual([]); // 통과 못 한 안이 없음
  });
});

describe('10단계 사회자', () => {
  it('수정: 통과 못 한 안에 조건부·반대를 낸 사람 + 다시 짠 안에서 자기 꼭 지킬 곳·좋아하는 곳이 빠진 사람만 다시 말함', () => {
    const ev = roundOf([
      evalOf('mem_1', ['반대', 2], ['찬성', 8]), // A 평균 (2 + 8 + 8 + 9) ÷ 4 = 6.75
      evalOf('mem_2', ['찬성', 8], ['조건부', 6]), // 통과한 B안에만 조건부 → 다시 묻지 않음
      evalOf('mem_3', ['찬성', 8], ['찬성', 8]),
      evalOf('mem_4', ['찬성', 9], ['찬성', 9]),
    ]);
    const t = tallyOf(ev, plans, 7);
    expect(t.map((x) => x.passed)).toEqual([false, true]);
    // A안 v2에서 mem_3이 좋아한 A2가 빠짐
    const before = [planOf('A', 1, [stopOf('plc_A1'), stopOf('plc_A2', { likedBy: ['mem_3'] })]), planOf('B', 1)];
    const after = [planOf('A', 2, [stopOf('plc_A1'), stopOf('plc_C1')]), planOf('B', 1)];
    const hurt = hurtBy(before, after);
    expect(hurt).toEqual(['mem_3']);
    expect(speakersOf('revise', members, ev, t, hurt, new Set())).toEqual(['mem_1', 'mem_3']);
    // 요청이 반영된 사람도 자기가 고쳐 달라고 한 결과를 봄 (찬성하면서 요청을 낸 mem_4)
    expect(speakersOf('revise', members, ev, t, hurt, new Set(['mem_4']))).toEqual(['mem_1', 'mem_3', 'mem_4']);
    // 버전이 같은 안은 보지 않음 (바뀌지 않음)
    expect(hurtBy(before, [planOf('A', 1, [stopOf('plc_A1')]), planOf('B', 1)])).toEqual([]);
  });

  it('다듬기: 요청이 반영된 사람 + 빠진 곳 때문에 다친 사람, 아무도 없으면 모두', () => {
    const ev = roundOf([evalOf('mem_1', ['조건부', 7], ['찬성', 8]), evalOf('mem_2', ['찬성', 9], ['찬성', 9])]);
    const t = tallyOf(ev, plans, 7);
    expect(speakersOf('polish', members, ev, t, ['mem_4'], new Set(['mem_1']))).toEqual(['mem_1', 'mem_4']);
    expect(speakersOf('polish', members, ev, t, [], new Set())).toEqual(['mem_1', 'mem_2', 'mem_3', 'mem_4']);
  });
});

describe('다음 평가에 넘기는 바뀐 곳', () => {
  it('다시 짠 안마다 새로 들어온 곳·빠진 곳 (버전이 같은 안은 빈 목록, 숙소는 보지 않음)', () => {
    const before = [planOf('A', 1, [stopOf('plc_A1'), stopOf('plc_A2')]), planOf('B', 1)];
    const after = [planOf('A', 2, [stopOf('plc_A1'), stopOf('plc_C1')]), planOf('B', 1)];
    expect(planDiff(before, after)).toEqual({ A: { added: ['plc_C1'], removed: ['plc_A2'] }, B: { added: [], removed: [] } });
  });
});

describe('다듬기 되돌리기 (10/19 사용자 결정)', () => {
  const states: PlanStates = { A: { sets: [['A1', 'A2']], banned: [], shared: [] }, B: { sets: [['B1', 'B2']], banned: [], shared: [] } };
  const polished = [planOf('A', 2, [stopOf('plc_A1'), stopOf('plc_C1')]), planOf('B', 2, [stopOf('plc_B1'), stopOf('plc_C2')])];
  const before = roundOf([evalOf('mem_1', ['조건부', 7], ['조건부', 7]), evalOf('mem_2', ['찬성', 9], ['찬성', 8])]);
  const snap: PolishSnapshot = { averages: { A: 8, B: 7.5 }, plans, states, extras: [], evaluation: before, touched: ['A', 'B'] };

  it('다듬은 안 중 평균이 떨어진 안만 다듬기 전으로 (내용은 그대로, version만 올림, 평가·사실표도 그때 것), 오르거나 같은 안은 둠', () => {
    const after = roundOf([evalOf('mem_1', ['반대', 5], ['찬성', 9]), evalOf('mem_2', ['찬성', 9], ['찬성', 8])], 2);
    const t = tallyOf(after, polished, 7);
    expect(t.map((x) => x.average)).toEqual([7, 8.5]); // A 8 → 7 떨어짐, B 7.5 → 8.5 오름
    const out = revertPolish(snap, { plans: polished, extras: [], states: { ...states, A: { sets: [['A1', 'C1']], banned: ['A2'], shared: [] } } }, after, t);
    expect(out.reverted).toEqual(['A']);
    expect(out.plans[0]).toMatchObject({ planId: 'pln_a', version: 3, route: plans[0].route });
    expect(out.plans[0].changes?.[0]).toMatch(/^다듬기 전으로 되돌림/);
    expect(out.plans[1]).toBe(polished[1]);
    expect(out.states.A).toEqual(states.A);
    const m1 = out.evaluation.members.find((e) => e.memberId === 'mem_1')!;
    expect(m1.plans.map((v) => [v.plan, v.stance, v.score])).toEqual([
      ['A', '조건부', 7],
      ['B', '찬성', 9],
    ]);
    expect(tallyOf(out.evaluation, out.plans, 7)[0].average).toBe(8);
  });

  it('다듬지 않은 안은 내용이 그대로라 다듬기 전 평가를 씀: 다시 부른 AI가 그 안에 입장을 바꿔 평균이 기준 아래로 떨어져도 통과 그대로 (10/29 점검)', () => {
    const onlyA: PolishSnapshot = { ...snap, touched: ['A'] };
    const polishedA = [polished[0], plans[1]];
    // 다듬은 A는 오름(8 → 8.5), 다듬지 않은 B는 mem_1이 찬성 → 반대로 바꿔 7.5 → 6.5 (기준 7 아래)
    const after = roundOf([evalOf('mem_1', ['찬성', 8], ['반대', 5]), evalOf('mem_2', ['찬성', 9], ['찬성', 8])], 2);
    const t = tallyOf(after, polishedA, 7);
    expect(t.map((x) => [x.average, x.passed])).toEqual([
      [8.5, true],
      [6.5, false],
    ]);
    const out = revertPolish(onlyA, { plans: polishedA, extras: [], states }, after, t);
    expect(out.reverted).toEqual([]);
    expect(out.restored).toEqual(['B']);
    expect(out.plans).toEqual(polishedA); // 안 내용은 그대로 (B는 처음부터 다듬지 않음)
    expect(tallyOf(out.evaluation, out.plans, 7).map((x) => [x.average, x.passed])).toEqual([
      [8.5, true],
      [7.5, true],
    ]);
  });

  it('떨어진 안이 없으면 그대로', () => {
    const after = roundOf([evalOf('mem_1', ['찬성', 8], ['찬성', 8]), evalOf('mem_2', ['찬성', 9], ['찬성', 8])], 2);
    const out = revertPolish(snap, { plans: polished, extras: [], states }, after, tallyOf(after, polished, 7));
    expect(out.reverted).toEqual([]);
    expect(out.restored).toEqual([]);
    expect(out.plans).toEqual(polished);
  });
});
