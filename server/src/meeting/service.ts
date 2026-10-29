import { Command } from '@langchain/langgraph';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { meetingReviews, meetings, members, personas, trips } from '../db/schema.js';
import type { AccessGrant } from '../lib/access.js';
import type { Member } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { stableJson } from '../lib/stable.js';
import { nowKst } from '../lib/time.js';
import { openPlans } from './choose.js';
import { MEETING_STEP_LIMIT, type MeetingStateType, type SavedResults, type buildMeetingGraph, loadMeetingInput } from './graph.js';
import type { SavedNameMatch } from './names.js';
import type { PickResult } from './pick.js';
import { tallyReview } from './review.js';
import { type EventPublisher, type MeetingEnvelope, type MeetingEventDraft, type MeetingLimits, eventRecorder, finishMeeting, isLlmTrace, reopenTrip, startMeeting } from './runs.js';
import type { ReviewChoice, ReviewDecision, ReviewRequest, TripConditions } from './types.js';

type MeetingGraph = ReturnType<typeof buildMeetingGraph>;
type MeetingRow = typeof meetings.$inferSelect;

/** 회의 실행을 지켜보는 쪽 (시험 화면의 한 줄 전송): 기록한 이벤트 · LLM 과정 · 노드가 끝남 */
export interface MeetingObserver {
  event?(e: MeetingEnvelope): void;
  trace?(e: MeetingEventDraft): void;
  node?(node: string, ms: number): void;
}

/** 실행 한 번의 끝: 사람 확인에서 멈춤 · 끝 · 실패 */
export type RunOutcome = { status: 'reviewing' | 'done' | 'failed'; state: MeetingStateType | null; error?: unknown };

/** API에 보이는 회의 상태 (명세서: 시작하면 researching) */
const STATUS_VIEW = { running: 'researching', reviewing: 'reviewing', done: 'done', failed: 'failed' } as const;

export interface MeetingServiceDeps {
  db: Db;
  graph: MeetingGraph;
  limits: MeetingLimits;
  /** 기록한 이벤트를 실시간 연결(WebSocket)로도 보냄 */
  publisher?: EventPublisher;
  /** LLM_REPLAY: 회의를 시작할 때 지난 회의의 결과를 모아 넘김 (그래프는 LLM 없이 만듦) */
  replay?: boolean;
  /** 접근 키로 시작한 회의가 쓰는 그래프 (LLM_REPLAY=true여도 LLM을 부름, 체크포인트는 같은 곳). 없으면 graph */
  liveGraph?: MeetingGraph;
  /** 접근 키로 시작한 회의도 지난 회의의 결과를 다시 쓰는지 (ACCESS_LLM_REPLAY가 off가 아니면) */
  liveReplay?: boolean;
}

/**
 * 회의 실행기: 공식 경로(POST /trips/{id}/meetings)와 시험 경로가 함께 씀
 * 그래프는 뒤에서 돌고, 5단계 사람 확인에서 멈추면 회의 상태를 reviewing으로 바꾼 뒤 review.requested를 보냄 (응답은 그 뒤에만 받음)
 * 사람 응답이 마감되면 상태를 running으로 바꾸는 쪽 하나만 Command({ resume })로 이어서 실행함 (두 번 이어서 실행되지 않음)
 */
export function meetingService({ db, graph, limits, publisher, replay = false, liveGraph, liveReplay = replay }: MeetingServiceDeps) {
  const configOf = (meetingId: string) => ({ configurable: { thread_id: meetingId } });
  const recorderOf = (m: Pick<MeetingRow, 'id' | 'tripId'>) => eventRecorder(db, m.tripId, m.id, publisher);
  const graphOf = (m: Pick<MeetingRow, 'accessLabel'>) => (m.accessLabel && liveGraph ? liveGraph : graph);

  async function run(meeting: Pick<MeetingRow, 'id' | 'tripId' | 'accessLabel'>, input: Record<string, unknown> | Command, observer?: MeetingObserver): Promise<RunOutcome> {
    const record = recorderOf(meeting);
    const graph = graphOf(meeting);
    let mark = Date.now();
    try {
      // 끝난 상태와 멈춘 까닭(사람 확인)은 실행 흐름에서 바로 받음: 끝난 뒤 getState()로 읽으면 체크포인트 id(시각 기반)가 시계가 뒤로 가는 순간 꼬여
      // 이전 단계의 상태를 읽을 수 있음 (10/28 점검: 시계를 5초 되돌리면 보드 없는 상태 · 사람 확인 없음으로 읽혀 'done'이 됨)
      let state: MeetingStateType | null = null;
      let pending: ReviewRequest | null = null;
      const stream = await graph.stream(input as never, { ...configOf(meeting.id), recursionLimit: MEETING_STEP_LIMIT, streamMode: ['custom', 'updates', 'values'] });
      for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
        if (mode === 'custom') {
          const e = chunk as MeetingEventDraft;
          if (isLlmTrace(e.type)) observer?.trace?.(e);
          else {
            // 기록을 먼저 함 (observer?.event?.(await …)로 쓰면 지켜보는 쪽이 없을 때 기록까지 건너뜀)
            const envelope = await record(e);
            observer?.event?.(envelope);
          }
        } else if (mode === 'values') {
          // 멈추면 마지막 values 조각에 멈춘 까닭(__interrupt__)이 실려 오기도 함: 상태 칸이 함께 있을 때만 상태로 씀
          const { __interrupt__: interrupts, ...values } = chunk as Record<string, unknown> & { __interrupt__?: { value?: unknown }[] };
          if (interrupts?.[0] && !pending) pending = interrupts[0].value as ReviewRequest;
          if (Object.keys(values).length) state = values as unknown as MeetingStateType;
        } else
          for (const [node, value] of Object.entries(chunk as object)) {
            if (node === '__interrupt__') {
              const first = (value as { value?: unknown }[] | undefined)?.[0];
              if (first) pending = first.value as ReviewRequest;
              continue;
            }
            observer?.node?.(node, Date.now() - mark);
            mark = Date.now();
          }
      }
      if (!state) state = (await graph.getState(configOf(meeting.id))).values as MeetingStateType;
      if (pending) {
        const request = pending;
        await db.update(meetings).set({ status: 'reviewing', review: request }).where(eq(meetings.id, meeting.id));
        const requested = await record({ type: 'review.requested', data: { meetingId: meeting.id, ...request, total: state.members.length } });
        observer?.event?.(requested);
        return { status: 'reviewing', state };
      }
      // 13단계까지 끝나면 여행의 일정 표를 엶 (14단계 사람 고르기). 열지 못하면 회의를 실패로 둠 (아래 catch)
      await openPlans(db, meeting.tripId, meeting.id, state);
      await finishMeeting(db, meeting.id, 'done');
      return { status: 'done', state };
    } catch (err) {
      try {
        await finishMeeting(db, meeting.id, 'failed');
        // 공식 경로로 시작한 여행은 조건·성향을 고쳐 다시 시작할 수 있게 되돌림
        await reopenTrip(db, meeting.tripId);
      } catch (cleanupErr) {
        // 이 약속을 기다리는 곳이 없으므로 여기서 던지면 처리되지 않은 거절로 서버가 꺼짐
        console.error('회의 실패 정리 실패:', cleanupErr);
      }
      console.error('회의 실행 실패:', err);
      try {
        const failed = await record({ type: 'meeting.failed', data: { meetingId: meeting.id, reason: 'error', planId: null } });
        observer?.event?.(failed);
      } catch (recordErr) {
        console.error('회의 실패 기록 실패:', recordErr);
      }
      return { status: 'failed', state: null, error: err };
    }
  }

  /** 회의 행을 읽고 같은 여행인지 확인함 (tx가 있으면 행을 잠금) */
  async function meetingOf(q: Pick<Db, 'select'>, meetingId: string, caller: Member, lock = false) {
    const query = q.select().from(meetings).where(eq(meetings.id, meetingId));
    const [m] = lock ? await query.for('update') : await query;
    if (!m) throw new ApiError('NOT_FOUND', '회의를 찾을 수 없음');
    if (m.tripId !== caller.tripId) throw new ApiError('FORBIDDEN', '참여한 여행의 회의만 볼 수 있음');
    return m;
  }
  const membersOf = (q: Pick<Db, 'select'>, tripId: string) => q.select().from(members).where(eq(members.tripId, tripId)).orderBy(asc(members.seat));

  /**
   * LLM_REPLAY: 이 여행의 지난 회의(최근 것부터) 체크포인트에서 다시 쓸 결과를 모음
   * 조건이 지금과 같은 회의만 봄 → 사람마다 AI가 고른 결과(source llm) 중 가장 최근 것, 그 회의 뒤에 성향을 바꾼 사람은 빼서 규칙으로 고름
   * 이름 맞추기는 이름표·낱말이 같은 규칙에만 다시 씀. 체크포인트는 회의가 끝난 뒤 MEETING_KEEP_DAYS일 동안 남음
   */
  // 현지 이동 수단(moveMode)은 6단계에만 쓰여 AI 고르기와 상관없으므로 비교에서 뺌 (v1.8 전에 저장한 조건에는 없음)
  const pickConditions = (c: TripConditions | null | undefined) => {
    if (!c) return stableJson(c ?? null);
    const { moveMode: _moveMode, ...rest } = c;
    return stableJson(rest);
  };
  async function savedResults(tripId: string): Promise<SavedResults> {
    const [trip] = await db.select({ conditions: trips.conditions }).from(trips).where(eq(trips.id, tripId));
    const personaAt = new Map(
      (
        await db
          .select({ memberId: personas.memberId, at: personas.updatedAt })
          .from(personas)
          .innerJoin(members, eq(members.id, personas.memberId))
          .where(eq(members.tripId, tripId))
      ).map((r) => [r.memberId, r.at]),
    );
    const past = await db.select({ id: meetings.id, startedAt: meetings.startedAt }).from(meetings).where(eq(meetings.tripId, tripId)).orderBy(desc(meetings.runNo));
    const picks = new Map<string, PickResult>();
    const names = new Map<string, SavedNameMatch>();
    for (const m of past) {
      const v = (await graph.getState(configOf(m.id))).values as Partial<MeetingStateType>;
      if (!v?.picks?.length || pickConditions(v.conditions) !== pickConditions(trip.conditions)) continue;
      for (const p of v.picks) {
        const at = personaAt.get(p.memberId);
        if (p.source !== 'llm' || picks.has(p.memberId) || !at || at > m.startedAt) continue;
        picks.set(p.memberId, { ...p, savedFrom: p.savedFrom ?? m.id });
      }
      for (const n of v.pool?.nameMatches ?? []) {
        const key = `${n.type ?? 'include'}\n${n.label}\n${n.keyword}`;
        if (!names.has(key)) names.set(key, n);
      }
    }
    return { picks: [...picks.values()], nameMatches: [...names.values()] };
  }

  /**
   * 회의 시작: 조건·성향을 확인하고 회의 행을 만든 뒤 그래프를 뒤에서 돌림
   * official: 공식 경로면 회의 행을 만드는 거래에서 여행 상태를 meeting으로 바꿈 (회의 중에는 참여·조건·성향을 바꾸지 않음)
   * replaceReviewing: 시험 경로에서 다시 실행하면 사람 확인을 기다리던 이전 회의를 그만둠 · onStart: 실행 전에 부름 (시험 화면이 회의 id를 먼저 보냄)
   */
  async function start(
    tripId: string,
    opts: { observer?: MeetingObserver; official?: boolean; replaceReviewing?: boolean; onStart?: (m: MeetingRow) => void; access?: AccessGrant } = {},
  ) {
    await loadMeetingInput(db, tripId); // 조건·성향이 준비되지 않았으면 실행 횟수를 쓰기 전에 오류
    const saved = (opts.access && liveGraph ? liveReplay : replay) ? await savedResults(tripId) : null;
    const meeting = await startMeeting(db, tripId, limits, { access: opts.access, official: opts.official, replaceReviewing: opts.replaceReviewing });
    opts.onStart?.(meeting);
    return { meeting, done: run(meeting, { tripId, meetingId: meeting.id, saved }, opts.observer) };
  }

  /** 회의 상태·사람 확인 현황 (GET /meetings/{id}) */
  async function view(meetingId: string, caller: Member) {
    const m = await meetingOf(db, meetingId, caller);
    const people = await membersOf(db, m.tripId);
    const responses = m.review ? await db.select().from(meetingReviews).where(eq(meetingReviews.meetingId, m.id)) : [];
    const answered = new Set(responses.map((r) => r.memberId));
    return {
      id: m.id,
      tripId: m.tripId,
      runNo: m.runNo,
      status: STATUS_VIEW[m.status],
      llmCalls: m.llmCalls,
      startedAt: nowKst(m.startedAt),
      finishedAt: m.finishedAt ? nowKst(m.finishedAt) : null,
      review: m.review
        ? {
            items: m.review.items,
            memos: m.review.memos,
            total: people.length,
            responded: people.filter((p) => answered.has(p.id)).map((p) => p.id),
            mine: responses.find((r) => r.memberId === caller.id)?.choices ?? null,
            decision: m.review.decision ?? null,
          }
        : null,
    };
  }

  /** 마감: 상태를 reviewing → running으로 바꾸는 쪽만 집계·이어서 실행함. by 'all'은 4명 모두 응답해 자동 마감 (이미 마감됐으면 null) */
  async function close(meetingId: string, caller: Member, by: ReviewDecision['closedBy'], observer?: MeetingObserver) {
    const closed = await db.transaction(async (tx) => {
      const m = await meetingOf(tx, meetingId, caller, true);
      if (by === 'host' && !caller.isHost) throw new ApiError('FORBIDDEN', '사람 확인은 방장만 마감할 수 있음');
      if (m.status !== 'reviewing' || !m.review) {
        if (by === 'all') return null;
        throw new ApiError('REVIEW_CLOSED', '사람 확인 중인 회의가 아님');
      }
      const people = await membersOf(tx, m.tripId);
      const rows = await tx.select().from(meetingReviews).where(eq(meetingReviews.meetingId, m.id));
      const decision = tallyReview(m.review, new Map(rows.map((r) => [r.memberId, r.choices])), people, by);
      await tx.update(meetings).set({ status: 'running', review: { ...m.review, decision } }).where(eq(meetings.id, m.id));
      return { meeting: m, decision };
    });
    if (!closed) return null;
    return { decision: closed.decision, done: run(closed.meeting, new Command({ resume: closed.decision }), observer) };
  }

  /**
   * 사람 확인 응답 (POST /meetings/{id}/review): 안건마다 남김·뺌을 모두 내야 함, 다시 내면 덮어씀
   * memberId: 시연 모드에서 방장이 가상 구성원 몫을 대신 낼 때만. 모두 응답하면 바로 마감하고 이어서 실행함
   */
  async function submitReview(meetingId: string, caller: Member, body: { memberId?: string; choices: ReviewChoice[] }, observer?: MeetingObserver) {
    const saved = await db.transaction(async (tx) => {
      const m = await meetingOf(tx, meetingId, caller, true);
      if (m.status !== 'reviewing' || !m.review) throw new ApiError('REVIEW_CLOSED', '사람 확인 중인 회의가 아님');
      const people = await membersOf(tx, m.tripId);
      let target: Member = caller;
      if (body.memberId && body.memberId !== caller.id) {
        const other = people.find((p) => p.id === body.memberId);
        if (!other) throw new ApiError('NOT_FOUND', '이 여행의 구성원이 아님');
        const [trip] = await tx.select({ demoMode: trips.demoMode }).from(trips).where(eq(trips.id, m.tripId));
        if (!caller.isHost || !trip.demoMode) throw new ApiError('FORBIDDEN', '다른 구성원의 응답은 시연 모드에서 방장만 대신 낼 수 있음');
        target = other;
      }
      const items = new Set(m.review.items.map((i) => i.placeId));
      const given = new Set(body.choices.map((c) => c.placeId));
      if (given.size !== body.choices.length) throw new ApiError('VALIDATION_ERROR', '같은 안건에 두 번 답함');
      const unknown = body.choices.find((c) => !items.has(c.placeId));
      if (unknown) throw new ApiError('VALIDATION_ERROR', `없는 안건임: ${unknown.placeId}`);
      if (given.size !== items.size) throw new ApiError('VALIDATION_ERROR', `안건 ${items.size}개 모두에 남김·뺌을 골라야 함`);
      const now = new Date();
      await tx
        .insert(meetingReviews)
        .values({ meetingId: m.id, memberId: target.id, choices: body.choices, submittedBy: caller.id, updatedAt: now })
        .onConflictDoUpdate({ target: [meetingReviews.meetingId, meetingReviews.memberId], set: { choices: body.choices, submittedBy: caller.id, updatedAt: now } });
      const answered = (await tx.select({ id: meetingReviews.memberId }).from(meetingReviews).where(eq(meetingReviews.meetingId, m.id))).length;
      return { meeting: m, target, answered, total: people.length };
    });
    const cast = await recorderOf(saved.meeting)({ type: 'review.cast', data: { meetingId: saved.meeting.id, memberId: saved.target.id, answered: saved.answered, total: saved.total } });
    observer?.event?.(cast);
    const closed = saved.answered >= saved.total ? await close(meetingId, caller, 'all', observer) : null;
    return { done: closed?.done ?? null };
  }

  /** 방장 '진행' (POST /meetings/{id}/review/close): 응답하지 않은 사람은 남김으로 셈 */
  async function closeReview(meetingId: string, caller: Member, observer?: MeetingObserver) {
    const closed = await close(meetingId, caller, 'host', observer);
    return { done: closed!.done };
  }

  return { start, run, view, submitReview, closeReview };
}

export type MeetingService = ReturnType<typeof meetingService>;
