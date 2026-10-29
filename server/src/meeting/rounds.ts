import type { EvalRound, MemberEval, PlanFacts, PlanLabel, RoundDiff } from './evaluate.js';
import type { Candidate, MemberInput } from './retrieve.js';
import type { EditResult, PlanEdit, PlanProposal, PlanStates } from './schedule.js';

/**
 * 회의 규칙 기본값·범위 (명세서 B1·4.4 rules, 조건 저장이 검사함). 통과 기준은 구성원 AI 예상 만족도 평균 (10/26 사용자 결정)
 * aiMinSatisfaction 7: NPS 0–6 비추천 경계를 근거로 씀 (Reichheld 2003, HBR 81(12)) · maxRounds: 포스터·명세서의 최대 5라운드
 */
export const MEETING_RULES = {
  aiMinSatisfaction: { default: 7, min: 1, max: 10 },
  maxRounds: { default: 5, min: 1, max: 5 },
} as const;

/**
 * 8–12단계 라운드 규칙 값 (모두 여기서만 바꿈). 10/29 사용자 승인 "8~10 같이": 집계 → 수정 → 사회자 → 다시 평가(11) → 다시 집계(12)를 최대 라운드까지
 * 통과: 안마다 구성원 AI 만족도(7단계 코드 계산)의 평균이 여행 조건 aiMinSatisfaction(기본 7) 이상. 가장 낮은 사람 조건은 없음 (10/26 사용자 결정 '4명 합친 평균',
 *   7점 근거: NPS 0–6 비추천 경계, Reichheld 2003, HBR 81(12))
 * changesPerPlan: 9단계에서 한 라운드에 안마다 반영하는 요청 수 (10/17 시험판 3: 한 번에 많이 바꾸면 무엇 때문에 점수가 바뀌었는지 흐려짐)
 * noProgressRounds: 통과 못 한 안의 평균이 이 라운드 수만큼 연속으로 지금까지의 가장 좋은 값보다 오르지 않으면 멈추고 그때의 A·B를 사람에게 넘김 (10/17 시험판 2)
 * nodesPerRound: 라운드 하나에 거치는 그래프 노드 (집계·수정·사회자·평가) · stepsMargin: 회의 한 번 실행의 노드 수 상한(LangGraph recursionLimit)에 더하는 여유
 *   (사람 확인 없이 5라운드까지 가면 24걸음이라 LangGraph 기본값 25에 거의 닿음: 노드를 하나만 더해도 실패하므로 계산한 상한을 따로 줌)
 */
export const ROUNDS = {
  changesPerPlan: 3,
  noProgressRounds: 2,
  nodesPerRound: 4,
  stepsMargin: 5,
} as const;

/** 8·12단계 집계 (안마다): 구성원 만족도의 평균과 통과 여부 */
export interface PlanTally {
  plan: PlanLabel;
  planId: string;
  version: number;
  average: number;
  passed: boolean;
}

/** 라운드 고리가 끝난 까닭: 둘 다 통과 · 최대 라운드 · 나아지지 않음 · 반영할 수 있는 요청이 없음 (모두 그때의 A·B를 사람에게 넘김, 10/26 사용자 확인) */
export type RoundsOutcome = 'passed' | 'max_rounds' | 'stalled' | 'no_change';

/** 다듬기 전 상태 (둘 다 통과한 뒤 남은 요청을 1번 반영해 보고, 다듬은 안의 평균이 떨어지면 이것으로 되돌림) */
export interface PolishSnapshot {
  averages: Partial<Record<PlanLabel, number>>;
  plans: PlanProposal[];
  states: PlanStates;
  extras: Candidate[];
  evaluation: EvalRound;
  touched: PlanLabel[];
}

/** 라운드 고리 상태 (회의 상태에 저장) */
export interface Deliberation {
  /** 집계가 정한 다음 일: 수정(통과 못 한 안) · 다듬기(둘 다 통과, 요청 남음) · 끝 */
  next: 'revise' | 'polish' | 'end';
  outcome: RoundsOutcome | null;
  /** 이 회의에서 반영한 요청 (같은 요청은 한 번만): 안|종류|곳|바꿀 곳 */
  tried: string[];
  /** 안마다 지금까지 가장 좋은 평균 · 나아지지 않은 라운드가 이어진 수 */
  best: Partial<Record<PlanLabel, number>>;
  stalls: number;
  polish: PolishSnapshot | null;
  /** 다듬어 봤다가 되돌린 안 */
  reverted: PlanLabel[];
}

/** 9단계에서 반영해 본 요청 한 건 (누가 낸 무슨 요청을 어느 곳에, 어떻게 되었는지. 글은 코드가 씀) */
export type AppliedEdit = EditResult & Pick<PlanEdit, 'type' | 'placeId' | 'toId'> & { by: string };

/** 라운드 기록의 평가: 사실표는 꼭 지킬 것만 남김 (체크포인트가 라운드마다 커지지 않게, 화면은 사실표를 쓰지 않음) */
export type RoundMember = Omit<MemberEval, 'facts'> & { facts: Pick<PlanFacts, 'plan' | 'musts'>[] };
export const roundMember = (e: MemberEval): RoundMember => ({ ...e, facts: e.facts.map((f) => ({ plan: f.plan, musts: f.musts })) });

/** 라운드 기록 (시험 화면용): 누가 말했는지, 그때의 두 안(날마다 장소 이름), 평가, 집계, 다음 일, 반영해 본 수정, 빠진 곳 때문에 다시 부를 사람 */
export interface RoundRecord {
  round: number;
  speakers: string[];
  plans: { label: PlanLabel; planId: string; version: number; days: string[][] }[];
  members: RoundMember[];
  tally: PlanTally[];
  next: Deliberation['next'] | null;
  outcome: RoundsOutcome | null;
  applied: AppliedEdit[];
  hurt: string[];
  reverted: PlanLabel[];
  /** 다듬어 본 라운드에서 평가를 다듬기 전 것으로 바꾼 안 (되돌린 안 + 다시 부른 AI의 입장이 달라졌던 다듬지 않은 안, 그 안의 vote.cast를 다시 보냄) */
  restored: PlanLabel[];
}

/** 8·12단계 집계: 안마다 평균 ≥ 기준이면 통과 */
export function tallyOf(evaluation: EvalRound, plans: readonly PlanProposal[], min: number): PlanTally[] {
  return plans.map((p) => {
    const scores = evaluation.members.map((e) => e.plans.find((v) => v.plan === p.label)?.score ?? 0);
    const average = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
    return { plan: p.label, planId: p.planId, version: p.version, average, passed: average >= min };
  });
}

export const editKey = (e: PlanEdit) => `${e.plan}|${e.type}|${e.placeId ?? ''}|${e.toId ?? ''}`;

/**
 * 9단계에 넘길 요청 (돌려주는 순서가 반영 순서)
 * 수정: 통과 못 한 안의 요청만 · 다듬기: 통과한 안에 조건부·반대를 낸 사람의 그 안 요청만
 * 그 안의 만족도가 낮은 사람의 요청부터 (같으면 자리 순서, 한 사람 안에서는 낸 순서). 이 회의에서 이미 반영한 요청과 같은 요청은 빼고 한 번만
 * move의 뺄 곳이 비어 있으면 그 사람 사실표의 가장 긴 바꿀 수 있는 이동에서 뺄 곳을 씀 (7단계 사실표와 같은 잣대)
 */
export function requestsFor(mode: 'revise' | 'polish', evaluation: EvalRound, tally: readonly PlanTally[], tried: ReadonlySet<string>): (PlanEdit & { by: string })[] {
  const passed = new Set(tally.filter((t) => t.passed).map((t) => t.plan));
  const list = evaluation.members.flatMap((e, seat) =>
    e.requests.map((r, i) => {
      const view = e.plans.find((v) => v.plan === r.plan);
      const placeId = r.type === 'move' && !r.placeId ? (e.facts.find((f) => f.plan === r.plan)?.longest?.out ?? null) : r.placeId;
      return { edit: { plan: r.plan, type: r.type, placeId, toId: r.toId, by: e.memberId }, score: view?.score ?? 0, stance: view?.stance, seat, i };
    }),
  );
  const seen = new Set(tried);
  return list
    .filter((x) => (mode === 'revise' ? !passed.has(x.edit.plan) : passed.has(x.edit.plan) && x.stance !== '찬성'))
    .sort((a, b) => a.score - b.score || a.seat - b.seat || a.i - b.i)
    .map((x) => x.edit)
    .filter((e) => {
      const key = editKey(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** 9단계로 다시 짠 안마다 새로 들어온 곳·빠진 곳 (숙소 빼고, 다음 평가 표에 '새로 들어옴'·사실 칸에 '바뀜'으로 보임). 버전이 같은 안은 빈 목록 */
export function planDiff(before: readonly PlanProposal[], after: readonly PlanProposal[]): RoundDiff {
  const ids = (p: PlanProposal) => new Set(p.route.flatMap((d) => d.stops.filter((s) => s.kind !== 'lodging').map((s) => s.placeId)));
  return Object.fromEntries(
    after.map((p) => {
      const old = before.find((o) => o.label === p.label);
      if (!old || old.version === p.version) return [p.label, { added: [], removed: [] }];
      const now = ids(p);
      const was = ids(old);
      return [p.label, { added: [...now].filter((x) => !was.has(x)), removed: [...was].filter((x) => !now.has(x)) }];
    }),
  );
}

/** 다시 짠 안에서 빠진 곳이 자기 꼭 지킬 곳·좋아하는 곳이었던 사람 (6단계가 장소마다 적은 mustFor·likedBy로) */
export function hurtBy(before: readonly PlanProposal[], after: readonly PlanProposal[]): string[] {
  const hurt = new Set<string>();
  for (const old of before) {
    const now = after.find((p) => p.label === old.label);
    if (!now || now.version === old.version) continue;
    const left = new Set(now.route.flatMap((d) => d.stops.map((s) => s.placeId)));
    for (const s of old.route.flatMap((d) => d.stops)) if (!left.has(s.placeId)) for (const m of [...s.mustFor, ...s.likedBy]) hurt.add(m);
  }
  return [...hurt];
}

/**
 * 10단계 사회자 (코드, LLM 0회): 다음 라운드에 다시 평가할 사람
 * 수정: 통과 못 한 안에 조건부·반대를 낸 사람 + 고친 뒤 빠진 곳이 자기 꼭 지킬 곳·좋아하는 곳이었던 사람 + 요청이 반영된 사람(자기가 고쳐 달라고 한 결과를 봄)
 * 다듬기: 요청이 반영된 사람 + 빠진 곳이 그랬던 사람 (통과 못 한 안이 없으므로)
 * 아무도 없으면 모두. 나머지는 지난 평가를 그대로 두고 만족도만 바뀐 일정으로 다시 계산함 (evaluate.carryEval)
 */
export function speakersOf(
  mode: 'revise' | 'polish',
  members: readonly MemberInput[],
  evaluation: EvalRound,
  tally: readonly PlanTally[],
  hurt: readonly string[],
  appliedBy: ReadonlySet<string>,
): string[] {
  const failed = new Set(tally.filter((t) => !t.passed).map((t) => t.plan));
  const unhappy = (e: MemberEval | undefined) => !!e && e.plans.some((v) => failed.has(v.plan) && v.stance !== '찬성');
  const out = members
    .filter((m) => hurt.includes(m.memberId) || appliedBy.has(m.memberId) || (mode === 'revise' && unhappy(evaluation.members.find((e) => e.memberId === m.memberId))))
    .map((m) => m.memberId);
  return out.length ? out : members.map((m) => m.memberId);
}

const emptyDeliberation = (): Deliberation => ({ next: 'end', outcome: null, tried: [], best: {}, stalls: 0, polish: null, reverted: [] });

/**
 * 8·12단계 다음 일 (다듬어 본 라운드가 아닐 때, 되돌리기는 그래프가 함)
 * 둘 다 통과: 통과한 안에 반영할 요청이 남고(polishable) 마지막 라운드가 아니면 1번 다듬어 봄 (10/19 사용자 결정), 아니면 끝(passed)
 * 통과 못 한 안이 있음: 마지막 라운드면 끝(max_rounds) → 통과 못 한 안의 평균이 noProgressRounds 라운드 연속 (통과 못 한 동안의) 가장 좋은 값보다 오르지 않으면 끝(stalled) → 수정
 */
export function decide(prev: Deliberation | null, tally: readonly PlanTally[], round: number, maxRounds: number, polishable: boolean): Deliberation {
  const d: Deliberation = { ...(prev ?? emptyDeliberation()), best: { ...prev?.best } };
  if (tally.every((t) => t.passed)) return polishable && round < maxRounds ? { ...d, next: 'polish' } : { ...d, next: 'end', outcome: 'passed' };
  if (round >= maxRounds) return { ...d, next: 'end', outcome: 'max_rounds' };
  const improved = tally.some((t) => !t.passed && t.average > (d.best[t.plan] ?? -Infinity));
  // 가장 좋은 값은 통과 못 한 동안만 셈 (통과했던 라운드의 평균과 비교하면 다시 떨어진 안이 오르는 중에도 '정체'가 됨, 10/29 점검)
  for (const t of tally) {
    if (t.passed) delete d.best[t.plan];
    else d.best[t.plan] = Math.max(d.best[t.plan] ?? -Infinity, t.average);
  }
  d.stalls = improved ? 0 : d.stalls + 1;
  if (d.stalls >= ROUNDS.noProgressRounds) return { ...d, next: 'end', outcome: 'stalled' };
  return { ...d, next: 'revise' };
}

/**
 * 다듬어 본 라운드의 되돌리기 (10/19 사용자 결정): 다듬은 안의 평균이 다듬기 전보다 떨어졌으면 그 안을 다듬기 전으로 되돌림
 * 되돌린 안은 내용은 다듬기 전 그대로 두고 version만 올림 (앱이 같은 planId의 가장 큰 version을 씀), 그 안의 평가·사실표도 다듬기 전 것으로
 * 다듬지 않은 안은 내용이 그대로이므로 평가도 다듬기 전 것을 씀 (다시 부른 AI가 같은 안에 입장을 바꿔 통과했던 안이 떨어지는 일을 막음)
 * restored: 평가를 다듬기 전 것으로 바꾼 안 (되돌린 안 + 다시 부른 AI의 입장이 달라졌던 다듬지 않은 안) → 그 안의 vote.cast를 다시 보냄
 */
export function revertPolish(
  snap: PolishSnapshot,
  current: { plans: readonly PlanProposal[]; extras: readonly Candidate[]; states: PlanStates },
  evaluation: EvalRound,
  tally: readonly PlanTally[],
): { reverted: PlanLabel[]; restored: PlanLabel[]; plans: PlanProposal[]; extras: Candidate[]; states: PlanStates; evaluation: EvalRound } {
  const averageOf = (l: PlanLabel) => tally.find((x) => x.plan === l)?.average ?? 0;
  const reverted = snap.touched.filter((l) => averageOf(l) < (snap.averages[l] ?? -Infinity));
  const viewKey = (e: { plans: { plan: PlanLabel; stance: string; score: number }[] } | undefined, l: PlanLabel) => {
    const v = e?.plans.find((x) => x.plan === l);
    return v ? `${v.stance}|${v.score}` : '';
  };
  const untouchedChanged = current.plans
    .map((p) => p.label)
    .filter((l) => !snap.touched.includes(l) && evaluation.members.some((e) => viewKey(e, l) !== viewKey(snap.evaluation.members.find((o) => o.memberId === e.memberId), l)));
  const restored = [...reverted, ...untouchedChanged];
  if (!restored.length) return { reverted, restored, plans: [...current.plans], extras: [...current.extras], states: current.states, evaluation };
  const back = new Set(reverted);
  const plans = current.plans.map((p) => {
    const old = snap.plans.find((o) => o.label === p.label);
    if (!back.has(p.label) || !old) return p;
    return { ...old, version: p.version + 1, changes: [`다듬기 전으로 되돌림 (평균 ${snap.averages[p.label]!.toFixed(1)} → ${averageOf(p.label).toFixed(1)}로 떨어짐)`] };
  });
  const used = new Set(plans.flatMap((p) => p.route.flatMap((d) => d.stops.map((s) => s.placeId.replace(/^plc_/, '')))));
  const extras = [...new Map([...snap.extras, ...current.extras].map((c) => [c.id, c])).values()].filter((c) => used.has(c.id));
  const states: PlanStates = { ...current.states };
  for (const l of reverted) states[l] = snap.states[l];
  const fromSnap = new Set(restored);
  const members = evaluation.members.map((e) => {
    const old = snap.evaluation.members.find((o) => o.memberId === e.memberId);
    if (!old) return e;
    // 그 안의 입장·사실표·요청·코드가 고친 것을 함께 그때 것으로 (다듬은 안의 장소를 가리키는 요청이 남지 않게)
    return {
      ...e,
      plans: e.plans.map((v) => (fromSnap.has(v.plan) ? (old.plans.find((o) => o.plan === v.plan) ?? v) : v)),
      facts: e.facts.map((f) => (fromSnap.has(f.plan) ? (old.facts.find((o) => o.plan === f.plan) ?? f) : f)),
      requests: [...e.requests.filter((r) => !fromSnap.has(r.plan)), ...old.requests.filter((r) => fromSnap.has(r.plan))],
      fixes: [...e.fixes.filter((f) => !f.plan || !fromSnap.has(f.plan)), ...old.fixes.filter((f) => f.plan && fromSnap.has(f.plan))],
    };
  });
  return { reverted, restored, plans, extras, states, evaluation: { ...evaluation, members } };
}
