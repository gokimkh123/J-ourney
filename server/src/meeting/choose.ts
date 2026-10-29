import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { members, tripPlans, trips } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { nowKst } from '../lib/time.js';
import type { MeetingStateType, buildMeetingGraph } from './graph.js';
import { type RouteClient, cachedRouter, newRouteMeter } from './route.js';
import { type EventPublisher, eventRecorder } from './runs.js';
import { type HumanEdit, type ScheduleInput, editOptions, editPlan } from './schedule.js';

/**
 * 14·15단계 규칙 값 (모두 여기서만 바꿈). 10/29 사용자 "15까지 다 해버리자"
 * 10/14 결정: 사람에게는 A·B 두 안만 주고 재회의 없음 · 10/19 결정: 고른 안을 사람이 직접 고침(빼기·넣기·순서, 고칠 때마다 6단계 계산, LLM 0회) ·
 * 10/27 결정: 끼니 식당은 이때 사람이 바꿈 · 10/29 절대 규칙: 사람이 쓴 글은 받지 않음 (고치기·투표는 고른 값만)
 * optionSights·optionMeals: 넣을 관광지·바꿀 식당 보기 수 · editsPerRequest: 요청 한 번에 받는 고치기 수
 * 고르기: 모두 고르면 다수결, 같으면 방장이 고른 안 (방장이 안 골랐으면 AI 만족도 평균이 높은 안, 같으면 A) · 확정: 모두 찬성하면 확정, 한 명이라도 반대하면 다시 고치기 (명세서 B1 '구성원 전원 찬성 확정')
 */
export const CHOOSE = {
  optionSights: 20,
  optionMeals: 6,
  editsPerRequest: 10,
} as const;

type MeetingGraph = ReturnType<typeof buildMeetingGraph>;
type Member = typeof members.$inferSelect;
type Row = typeof tripPlans.$inferSelect;
type Label = 'A' | 'B';

/** 회의가 끝나면 여행의 일정 표를 엶 (13단계 결과 → 14단계 고르기). 같은 여행의 지난 표는 바꿈. 공식 경로 여행은 상태를 voting으로 */
export async function openPlans(db: Db, tripId: string, meetingId: string, state: MeetingStateType) {
  if (!state.final || !state.plans || !state.planStates) return;
  const candidates = state.final.map((f) => ({ ...f, plan: state.plans!.plans.find((p) => p.label === f.label)! }));
  const values = {
    meetingId,
    status: 'choosing' as const,
    candidates,
    states: state.planStates,
    choices: {},
    chosen: null,
    plan: null,
    planState: null,
    edits: [],
    votes: {},
    voteVersion: null,
    updatedAt: new Date(),
    confirmedAt: null,
  };
  await db.insert(tripPlans).values({ tripId, ...values }).onConflictDoUpdate({ target: tripPlans.tripId, set: values });
  await db.update(trips).set({ status: 'voting' }).where(and(eq(trips.id, tripId), eq(trips.status, 'meeting')));
}

/** 14·15단계 (사람 선택·고치기·확정) — 공식 API가 씀. 이벤트는 그 회의의 이벤트 흐름(seq)에 이어서 기록함 */
export function planService({ db, graph, router, publisher }: { db: Db; graph: MeetingGraph; router: RouteClient | null; publisher?: EventPublisher }) {
  const people = (q: Pick<Db, 'select'>, tripId: string) => q.select().from(members).where(eq(members.tripId, tripId)).orderBy(asc(members.seat));
  async function rowOf(q: Pick<Db, 'select'>, tripId: string, lock = false): Promise<Row> {
    const query = q.select().from(tripPlans).where(eq(tripPlans.tripId, tripId));
    const [r] = lock ? await query.for('update') : await query;
    if (!r) throw new ApiError('NOT_FOUND', '회의가 끝난 뒤(13단계 마무리 뒤)에 볼 수 있음');
    return r;
  }
  const own = (caller: Member, tripId: string) => {
    if (caller.tripId !== tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 볼 수 있음');
  };
  /** 시연 모드에서 방장이 다른 구성원 몫을 대신 냄 (5단계 사람 확인과 같은 규칙) */
  async function targetOf(tx: Pick<Db, 'select'>, caller: Member, tripId: string, memberId?: string): Promise<Member> {
    if (!memberId || memberId === caller.id) return caller;
    const other = (await people(tx, tripId)).find((p) => p.id === memberId);
    if (!other) throw new ApiError('NOT_FOUND', '이 여행의 구성원이 아님');
    const [trip] = await tx.select({ demoMode: trips.demoMode }).from(trips).where(eq(trips.id, tripId));
    if (!caller.isHost || !trip?.demoMode) throw new ApiError('FORBIDDEN', '다른 구성원 몫은 시연 모드에서 방장만 대신 낼 수 있음');
    return other;
  }
  const record = (r: Pick<Row, 'tripId' | 'meetingId'>) => eventRecorder(db, r.tripId, r.meetingId, publisher);

  /** 회의 체크포인트에서 6단계 재료를 읽음 (고칠 때 6단계 계산을 다시 하려고). failed: 회의 중 카카오가 답하지 못한 구간 (고칠 때 다시 묻지 않음) */
  async function inputOf(meetingId: string): Promise<{ input: ScheduleInput; failed: string[] }> {
    const v = (await graph.getState({ configurable: { thread_id: meetingId } })).values as Partial<MeetingStateType>;
    if (!v?.pool || !v.board || !v.members) throw new ApiError('PLAN_LOCKED', '이 회의의 단계 기록이 없어 고칠 수 없음 (오래된 회의)');
    return {
      input: { meetingId, pool: v.pool, board: v.board, members: v.members, decision: v.reviewDecision ?? null, moveMode: v.conditions?.moveMode ?? 'transit' },
      failed: v.plans?.failedRoutes ?? [],
    };
  }

  function viewOf(r: Row, ppl: Member[]) {
    const votedFor = ppl.filter((p) => r.choices[p.id]).map((p) => ({ memberId: p.id, planId: r.choices[p.id] }));
    const confirmVotes = ppl.filter((p) => r.votes[p.id]).map((p) => ({ memberId: p.id, decision: r.votes[p.id] }));
    return {
      status: r.status,
      meetingId: r.meetingId,
      candidates: r.candidates,
      choice: { votes: votedFor, answered: votedFor.length, total: ppl.length, chosen: r.chosen ?? null },
      plan: r.plan ?? null,
      edits: r.edits,
      confirm: r.voteVersion !== null ? { version: r.voteVersion, votes: confirmVotes, answered: confirmVotes.length, total: ppl.length } : null,
      confirmedAt: r.confirmedAt ? nowKst(r.confirmedAt) : null,
    };
  }
  async function view(tripId: string, caller: Member) {
    own(caller, tripId);
    return viewOf(await rowOf(db, tripId), await people(db, tripId));
  }

  /** 고르기 집계: 다수결 → 같으면 방장이 고른 안 → 방장이 안 골랐으면 AI 만족도 평균이 높은 안 → 같으면 A */
  function decide(r: Row, choices: Record<string, string>, ppl: Member[], by: 'all' | 'host') {
    const labelOf = (planId: string) => r.candidates.find((c) => c.planId === planId)?.label;
    const votes = { A: 0, B: 0 };
    for (const p of ppl) {
      const l = choices[p.id] ? labelOf(choices[p.id]) : undefined;
      if (l) votes[l]++;
    }
    const tie = votes.A === votes.B;
    const host = ppl.find((p) => p.isHost);
    const hostPick = host && choices[host.id] ? labelOf(choices[host.id]) : undefined;
    const avg = (l: Label) => r.candidates.find((c) => c.label === l)?.satisfaction.average ?? 0;
    const label: Label = !tie ? (votes.A > votes.B ? 'A' : 'B') : (hostPick ?? (avg('B') > avg('A') ? 'B' : 'A'));
    const c = r.candidates.find((x) => x.label === label)!;
    return { planId: c.planId, label, by, tie, votes };
  }
  const chosenSet = (r: Row, chosen: ReturnType<typeof decide>) => ({
    status: 'revising' as const,
    chosen,
    plan: r.candidates.find((c) => c.label === chosen.label)!.plan,
    planState: r.states[chosen.label],
  });

  /** 14단계 고르기 (POST /trips/{id}/plan/choice): 다시 내면 덮어씀, 모두 고르면 바로 정함 */
  async function choose(tripId: string, caller: Member, body: { planId: string; memberId?: string }) {
    own(caller, tripId);
    const out = await db.transaction(async (tx) => {
      const r = await rowOf(tx, tripId, true);
      if (r.status !== 'choosing') throw new ApiError('VOTE_CLOSED', '이미 안을 정함');
      if (!r.candidates.some((c) => c.planId === body.planId)) throw new ApiError('VALIDATION_ERROR', `없는 안임: ${body.planId}`);
      const target = await targetOf(tx, caller, tripId, body.memberId);
      const choices = { ...r.choices, [target.id]: body.planId };
      const ppl = await people(tx, tripId);
      const answered = ppl.filter((p) => choices[p.id]).length;
      const chosen = answered >= ppl.length ? decide(r, choices, ppl, 'all') : null;
      await tx
        .update(tripPlans)
        .set({ choices, ...(chosen ? chosenSet(r, chosen) : {}), updatedAt: new Date() })
        .where(eq(tripPlans.tripId, tripId));
      return { r, target, answered, total: ppl.length, chosen };
    });
    await record(out.r)({ type: 'choice.cast', data: { memberId: out.target.id, planId: body.planId, answered: out.answered, total: out.total } });
    if (out.chosen) await record(out.r)({ type: 'plan.chosen', data: { ...out.chosen, version: out.r.candidates.find((c) => c.label === out.chosen!.label)!.version } });
    return view(tripId, caller);
  }

  /** 방장 '정하기' (POST /trips/{id}/plan/choice/close): 고른 사람만으로 정함 */
  async function closeChoice(tripId: string, caller: Member) {
    own(caller, tripId);
    if (!caller.isHost) throw new ApiError('FORBIDDEN', '방장만 정할 수 있음');
    const out = await db.transaction(async (tx) => {
      const r = await rowOf(tx, tripId, true);
      if (r.status !== 'choosing') throw new ApiError('VOTE_CLOSED', '이미 안을 정함');
      const chosen = decide(r, r.choices, await people(tx, tripId), 'host');
      await tx.update(tripPlans).set({ ...chosenSet(r, chosen), updatedAt: new Date() }).where(eq(tripPlans.tripId, tripId));
      return { r, chosen };
    });
    await record(out.r)({ type: 'plan.chosen', data: { ...out.chosen, version: out.r.candidates.find((c) => c.label === out.chosen.label)!.version } });
    return view(tripId, caller);
  }

  /** 고칠 때 고를 보기 (GET /trips/{id}/plan/options): 넣을 수 있는 관광지·끼니마다 바꿀 수 있는 식당 */
  async function options(tripId: string, caller: Member) {
    own(caller, tripId);
    const r = await rowOf(db, tripId);
    if (!r.plan) throw new ApiError('PLAN_LOCKED', 'A·B를 먼저 골라야 함');
    return editOptions(db, (await inputOf(r.meetingId)).input, r.plan, { sights: CHOOSE.optionSights, meals: CHOOSE.optionMeals });
  }

  /**
   * 고치기 (POST /trips/{id}/plan/edits): 구성원 누구나, 고른 값만 받음. 6단계 계산으로 다시 짜 plan.proposed(같은 planId, version + 1)
   * 동시에 고치면 먼저 저장한 쪽만 (version이 그대로일 때만 저장, 아니면 PLAN_LOCKED로 다시 불러오게 함)
   */
  async function edit(tripId: string, caller: Member, edits: HumanEdit[]) {
    own(caller, tripId);
    const r = await rowOf(db, tripId);
    if (r.status !== 'revising' || !r.plan || !r.planState) throw new ApiError('PLAN_LOCKED', r.status === 'choosing' ? 'A·B를 먼저 골라야 함' : '확정 투표 중이거나 확정되어 고칠 수 없음');
    const meter = newRouteMeter();
    const { input, failed } = await inputOf(r.meetingId);
    const out = await editPlan(db, cachedRouter(db, router, meter, undefined, new Set(failed)), input, { plan: r.plan, state: r.planState }, edits);
    if (out.plan !== r.plan) {
      const saved = await db
        .update(tripPlans)
        .set({ plan: out.plan, planState: out.state, edits: [...r.edits, { version: out.plan.version, by: caller.id, at: nowKst(), changes: out.plan.changes ?? [] }], updatedAt: new Date() })
        .where(and(eq(tripPlans.tripId, tripId), eq(tripPlans.status, 'revising'), sql`(${tripPlans.plan}->>'version')::int = ${r.plan.version}`))
        .returning({ tripId: tripPlans.tripId });
      if (!saved.length) throw new ApiError('PLAN_LOCKED', '다른 사람이 먼저 고쳤거나 확정 투표가 시작됨 — 다시 불러와 주세요');
      await record(r)({ type: 'plan.proposed', data: out.plan });
    }
    return { ...(await view(tripId, caller)), results: out.results, kakao: meter };
  }

  /** 15단계 확정 투표 시작 (POST /trips/{id}/plan/confirm, 방장): 지금 버전으로 모두에게 묻고 이 동안은 고치지 않음 */
  async function requestConfirm(tripId: string, caller: Member) {
    own(caller, tripId);
    if (!caller.isHost) throw new ApiError('FORBIDDEN', '방장만 확정 투표를 시작할 수 있음');
    const r = await db.transaction(async (tx) => {
      const row = await rowOf(tx, tripId, true);
      if (row.status !== 'revising' || !row.plan) throw new ApiError('PLAN_LOCKED', row.status === 'choosing' ? 'A·B를 먼저 골라야 함' : '이미 확정 투표 중이거나 확정됨');
      await tx.update(tripPlans).set({ status: 'voting', votes: {}, voteVersion: row.plan.version, updatedAt: new Date() }).where(eq(tripPlans.tripId, tripId));
      return row;
    });
    await record(r)({ type: 'confirm.requested', data: { planId: r.plan!.planId, version: r.plan!.version } });
    return view(tripId, caller);
  }

  /** 확정 투표 (POST /trips/{id}/plan/votes): 모두 찬성하면 확정(plan.confirmed), 한 명이라도 반대하면 다시 고치기로 돌아감 */
  async function vote(tripId: string, caller: Member, body: { decision: 'approve' | 'reject'; memberId?: string }) {
    own(caller, tripId);
    const out = await db.transaction(async (tx) => {
      const r = await rowOf(tx, tripId, true);
      if (r.status !== 'voting' || !r.plan) throw new ApiError('VOTE_CLOSED', '확정 투표 중이 아님');
      const target = await targetOf(tx, caller, tripId, body.memberId);
      const votes = { ...r.votes, [target.id]: body.decision };
      const ppl = await people(tx, tripId);
      const answered = ppl.filter((p) => votes[p.id]).length;
      const result = body.decision === 'reject' ? ('rejected' as const) : ppl.every((p) => votes[p.id] === 'approve') ? ('confirmed' as const) : null;
      if (result === 'rejected') await tx.update(tripPlans).set({ status: 'revising', votes: {}, voteVersion: null, updatedAt: new Date() }).where(eq(tripPlans.tripId, tripId));
      else if (result === 'confirmed') {
        await tx.update(tripPlans).set({ status: 'confirmed', votes, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(tripPlans.tripId, tripId));
        await tx.update(trips).set({ status: 'confirmed' }).where(and(eq(trips.id, tripId), eq(trips.status, 'voting')));
      } else await tx.update(tripPlans).set({ votes, updatedAt: new Date() }).where(eq(tripPlans.tripId, tripId));
      return { r, target, answered, total: ppl.length, result };
    });
    const plan = out.r.plan!;
    await record(out.r)({ type: 'confirm.cast', data: { planId: plan.planId, version: plan.version, memberId: out.target.id, decision: body.decision, answered: out.answered, total: out.total } });
    if (out.result === 'rejected') await record(out.r)({ type: 'confirm.closed', data: { planId: plan.planId, version: plan.version, result: 'rejected', by: out.target.id } });
    if (out.result === 'confirmed') await record(out.r)({ type: 'plan.confirmed', data: { planId: plan.planId, version: plan.version } });
    return view(tripId, caller);
  }

  return { view, choose, closeChoice, options, edit, requestConfirm, vote };
}

export type PlanService = ReturnType<typeof planService>;
