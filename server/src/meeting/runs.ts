import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { and, asc, desc, eq, gt, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { meetingEvents, meetings, trips } from '../db/schema.js';
import type { AccessGrant } from '../lib/access.js';
import { ApiError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { laneQueue } from '../lib/lane.js';
import { DAY_MS, nowKst } from '../lib/time.js';
import { tryConsumeLlmCall } from '../llm/usage.js';

/** 명세서 3장 ID: agt_ 에이전트(구성원마다 하나), plc_ 장소(TourAPI contentId) */
export const agentIdOf = (memberId: string) => `agt_${memberId.replace(/^mem_/, '')}`;
export const placeIdOf = (contentId: string) => `plc_${contentId}`;

/** 회의 이벤트 이름 (명세서 WebSocket 이벤트 표) */
export type MeetingEventType =
  | 'meeting.started'
  | 'research.progress'
  | 'board.updated'
  | 'agent.message'
  | 'review.requested'
  | 'review.cast'
  | 'review.closed'
  | 'plan.proposed'
  | 'round.started'
  | 'vote.cast'
  | 'meeting.failed';

/** 시험 화면에만 보내는 LLM 과정 이벤트 (요청 내용·받는 글자·원본 응답). DB에 기록하지 않음 */
export type LlmTraceType = 'llm.request' | 'llm.delta' | 'llm.response';
export const isLlmTrace = (type: string): type is LlmTraceType => type.startsWith('llm.');

/** 노드가 LangGraph custom 스트림으로 내보내는 이벤트 (봉투는 실행 쪽이 씌움) */
export interface MeetingEventDraft {
  type: MeetingEventType | LlmTraceType;
  data: Record<string, unknown>;
}

/** 명세서 WebSocket 봉투 */
export interface MeetingEnvelope {
  type: MeetingEventType;
  tripId: string;
  seq: number;
  at: string;
  data: Record<string, unknown>;
}

export interface MeetingLimits {
  runsPerTrip: number;
  llmCallsPerRun: number;
  llmDailyLimit: number;
}

/** 진행 중으로 보는 회의 상태: 실행 중이거나 사람 확인을 기다리는 회의가 있으면 새 회의를 시작하지 않음 */
const ACTIVE = ['running', 'reviewing'] as const;

/** 진행 중인 회의 하나 (없으면 undefined). 거래(tx) 안에서 부르면 같은 거래에서 읽음 */
export async function activeMeetingOf(q: Pick<Db, 'select'>, tripId: string) {
  const [m] = await q
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.tripId, tripId), inArray(meetings.status, [...ACTIVE])))
    .limit(1);
  return m;
}

export interface StartOptions {
  /** 접근 키로 시작하면 그 키로 시작한 회의가 quota개 미만일 때만 시작함 (키마다 잠가 동시에 와도 넘지 않음), 회의 행에 키 이름을 남김 */
  access?: AccessGrant;
  /** 공식 경로: 같은 거래에서 여행 상태를 meeting으로 바꿈 (회의 중에는 참여·조건·성향을 바꾸지 않음) */
  official?: boolean;
  /** 시험 경로에서 다시 실행: 사람 확인을 기다리던 이전 회의는 그만둠 (다른 확인을 모두 통과한 뒤에만) */
  replaceReviewing?: boolean;
}

/**
 * 회의 실행을 시작함: 진행 중인 실행이 있으면 MEETING_IN_PROGRESS(그 회의를 이어 보기), 실행 횟수를 다 썼으면 MEETING_LIMIT
 * 여행 행을 잠가 참여·조건 저장·성향 저장과 차례로 돎. 같은 여행에 동시에 두 요청이 와도 (trip_id, run_no) 고유 조건으로 하나만 만들어짐
 */
export async function startMeeting(db: Db, tripId: string, limits: MeetingLimits, opts: StartOptions = {}) {
  const { access } = opts;
  return db.transaction(async (tx) => {
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for('update');
    const rows = await tx.select().from(meetings).where(eq(meetings.tripId, tripId)).orderBy(desc(meetings.runNo));
    const running = rows.find((m) => m.status === 'running' || (m.status === 'reviewing' && !opts.replaceReviewing));
    if (running) throw new ApiError('MEETING_IN_PROGRESS', `이미 진행 중인 회의가 있음 (${running.id})`);
    if (rows.length >= limits.runsPerTrip) throw new ApiError('MEETING_LIMIT', `이 여행의 회의 실행 횟수(${limits.runsPerTrip}회)를 모두 씀`);
    if (access) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`access:${access.label}`}))`);
      const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(meetings).where(eq(meetings.accessLabel, access.label));
      if (used >= access.quota) throw new ApiError('ACCESS_QUOTA_EXCEEDED', `이 접근 키로 짤 수 있는 여행 횟수(${access.quota}회)를 모두 씀`);
    }
    const reviewing = rows.filter((m) => m.status === 'reviewing').length;
    if (opts.replaceReviewing && reviewing) {
      const dropped = await tx
        .update(meetings)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(and(eq(meetings.tripId, tripId), eq(meetings.status, 'reviewing')))
        .returning({ id: meetings.id });
      // 그 사이 사람 확인이 마감되어 이어서 실행 중이면(running) 새 회의를 열지 않음 (진행 중인 회의가 둘이 되지 않게)
      if (dropped.length < reviewing) throw new ApiError('MEETING_IN_PROGRESS', '사람 확인이 방금 마감되어 회의가 이어서 진행 중임');
      // 그만둔 회의가 공식 경로였으면 여행을 준비 상태로 되돌림 (이번 실행이 공식 경로면 아래에서 다시 meeting으로 바꿈)
      await tx.update(trips).set({ status: 'preparing' }).where(and(eq(trips.id, tripId), eq(trips.status, 'meeting')));
    }
    const id = newId('mtg');
    const inserted = await tx
      .insert(meetings)
      .values({ id, tripId, runNo: (rows[0]?.runNo ?? 0) + 1, status: 'running', accessLabel: access?.label ?? null })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) throw new ApiError('MEETING_IN_PROGRESS', '같은 여행의 회의가 방금 시작됨');
    if (opts.official) await tx.update(trips).set({ status: 'meeting' }).where(eq(trips.id, tripId));
    return inserted[0];
  });
}

/** 공식 경로로 시작한 여행을 준비 상태로 되돌림 (조건·성향을 고쳐 다시 시작할 수 있게). 그 사이 다른 회의가 진행 중이면 그대로 둠 */
export async function reopenTrip(db: Db, tripId: string) {
  await db
    .update(trips)
    .set({ status: 'preparing' })
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.status, 'meeting'),
        notExists(db.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.tripId, tripId), inArray(meetings.status, [...ACTIVE])))),
      ),
    );
}

/**
 * 이 회의에서 LLM을 1회 쓸 수 있으면 true: 실행 1회 상한(llmCallsPerRun) → 서버 전체 하루 상한(성향 카드와 같은 표) 순서로 확인
 * 하나라도 막히면 false (부르는 쪽이 규칙으로 대신함)
 */
export async function reserveMeetingLlm(db: Db, meetingId: string, limits: MeetingLimits): Promise<boolean> {
  const rows = await db
    .update(meetings)
    .set({ llmCalls: sql`${meetings.llmCalls} + 1` })
    .where(and(eq(meetings.id, meetingId), lt(meetings.llmCalls, limits.llmCallsPerRun)))
    .returning({ id: meetings.id });
  if (!rows.length) return false;
  if (await tryConsumeLlmCall(db, limits.llmDailyLimit)) return true;
  // 하루 상한에 닿아 부르지 않으면 이 회의의 횟수는 되돌림 (실제로 부른 횟수만 남김)
  await db.update(meetings).set({ llmCalls: sql`${meetings.llmCalls} - 1` }).where(eq(meetings.id, meetingId));
  return false;
}

export async function finishMeeting(db: Db, meetingId: string, status: 'done' | 'failed') {
  await db.update(meetings).set({ status, finishedAt: new Date() }).where(eq(meetings.id, meetingId));
}

/**
 * 서버가 켜질 때: 실행 중(running)으로 남은 회의는 끊긴 것이므로 실패로 바꿈 (서버는 한 대라 다른 곳에서 이어서 돌 수 없음)
 * 사람 확인을 기다리는 회의(reviewing)는 상태가 체크포인트에 있어 그대로 둠
 */
export async function failInterruptedMeetings(db: Db): Promise<number> {
  const rows = await db.update(meetings).set({ status: 'failed', finishedAt: new Date() }).where(eq(meetings.status, 'running')).returning({ id: meetings.id, tripId: meetings.tripId });
  // 실행 중 실패와 같게, 공식 경로로 시작한 여행은 조건·성향을 고쳐 다시 시작할 수 있게 되돌림
  const tripIds = [...new Set(rows.map((r) => r.tripId))];
  if (tripIds.length) await db.update(trips).set({ status: 'preparing' }).where(and(inArray(trips.id, tripIds), eq(trips.status, 'meeting')));
  // 실행 중 실패와 같은 이벤트를 남김: 앱이 다시 접속하면 afterSeq로 받아 실패를 앎 (10/28 명세서 대조: 서버를 다시 켜면 이벤트 없이 실패만 됨)
  for (const r of rows) await eventRecorder(db, r.tripId, r.id)({ type: 'meeting.failed', data: { meetingId: r.id, reason: 'error', planId: null } });
  return rows.length;
}

/** 여행별 실시간 연결로 이벤트를 보냄 (기록한 뒤 순서대로) */
export interface EventPublisher {
  publish(e: MeetingEnvelope): void;
}

/** 여행마다 이벤트 기록을 한 줄로 세움: 회의 실행과 사람 응답(API)이 동시에 기록해도 seq가 겹치지 않고 순서대로 보냄 */
const inLane = laneQueue();
/** 기록이 남은 여행 줄 수 (시험·확인용, 모두 끝나면 0) */
export const pendingEventLanes = () => inLane.size();

/** 이벤트를 기록하고 봉투를 돌려줌 (seq는 여행마다 이어짐). publisher가 있으면 기록 직후 실시간 연결로도 보냄 */
export function eventRecorder(db: Db, tripId: string, meetingId: string, publisher?: EventPublisher) {
  return (e: MeetingEventDraft): Promise<MeetingEnvelope> => {
    if (isLlmTrace(e.type)) return Promise.reject(new Error('LLM 과정 이벤트는 기록하지 않음'));
    const type = e.type;
    return inLane(tripId, async () => {
      const [row] = await db.select({ seq: sql<number>`coalesce(max(${meetingEvents.seq}), 0)` }).from(meetingEvents).where(eq(meetingEvents.tripId, tripId));
      const seq = Number(row.seq) + 1;
      const at = new Date();
      await db.insert(meetingEvents).values({ tripId, seq, meetingId, type, data: e.data, at });
      const envelope: MeetingEnvelope = { type, tripId, seq, at: nowKst(at), data: e.data };
      publisher?.publish(envelope);
      return envelope;
    });
  };
}

/** 다시 접속한 화면에 afterSeq 뒤의 이벤트를 보냄 */
export async function eventsAfter(db: Db, tripId: string, afterSeq: number): Promise<MeetingEnvelope[]> {
  const rows = await db
    .select()
    .from(meetingEvents)
    .where(and(eq(meetingEvents.tripId, tripId), gt(meetingEvents.seq, afterSeq)))
    .orderBy(asc(meetingEvents.seq));
  return rows.map((r) => ({ type: r.type as MeetingEventType, tripId: r.tripId, seq: r.seq, at: nowKst(r.at), data: r.data as Record<string, unknown> }));
}

/**
 * 끝난 지 keepDays일이 지난 회의의 단계 기록(체크포인트)을 지움. 회의 행·이벤트는 여행과 함께 남음
 * schema: 체크포인트가 있는 Postgres 스키마. 주면 기록이 아직 남은 회의만 골라 지움 (이미 지운 회의를 매일 다시 지우지 않게)
 */
export async function pruneMeetingCheckpoints(db: Db, checkpointer: BaseCheckpointSaver, keepDays: number, schema?: string): Promise<number> {
  const before = new Date(Date.now() - keepDays * DAY_MS);
  const stored = schema ? sql`exists (select 1 from ${sql.identifier(schema)}.checkpoints c where c.thread_id = ${meetings.id})` : undefined;
  const old = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(inArray(meetings.status, ['done', 'failed']), lt(meetings.finishedAt, before), stored));
  for (const m of old) await checkpointer.deleteThread(m.id);
  return old.length;
}
