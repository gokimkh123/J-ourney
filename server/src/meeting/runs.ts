import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { meetingEvents, meetings } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { nowKst } from '../lib/time.js';
import { tryConsumeLlmCall } from '../llm/usage.js';

/** 명세서 3장 ID: agt_ 에이전트(구성원마다 하나), plc_ 장소(TourAPI contentId) */
export const agentIdOf = (memberId: string) => `agt_${memberId.replace(/^mem_/, '')}`;
export const placeIdOf = (contentId: string) => `plc_${contentId}`;

/** 회의 이벤트 이름 (명세서 WebSocket 이벤트 표) */
export type MeetingEventType = 'meeting.started' | 'research.progress' | 'board.updated' | 'agent.message';

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

/**
 * 회의 실행을 시작함: 진행 중인 실행이 있으면 MEETING_IN_PROGRESS(그 회의를 이어 보기), 실행 횟수를 다 썼으면 MEETING_LIMIT
 * 같은 여행에 동시에 두 요청이 와도 (trip_id, run_no) 고유 조건으로 하나만 만들어짐
 */
export async function startMeeting(db: Db, tripId: string, limits: MeetingLimits) {
  const rows = await db.select().from(meetings).where(eq(meetings.tripId, tripId)).orderBy(desc(meetings.runNo));
  const running = rows.find((m) => m.status === 'running');
  if (running) throw new ApiError('MEETING_IN_PROGRESS', `이미 진행 중인 회의가 있음 (${running.id})`);
  if (rows.length >= limits.runsPerTrip) throw new ApiError('MEETING_LIMIT', `이 여행의 회의 실행 횟수(${limits.runsPerTrip}회)를 모두 씀`);
  const id = newId('mtg');
  const inserted = await db
    .insert(meetings)
    .values({ id, tripId, runNo: (rows[0]?.runNo ?? 0) + 1, status: 'running' })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) throw new ApiError('MEETING_IN_PROGRESS', '같은 여행의 회의가 방금 시작됨');
  return inserted[0];
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

/** 이벤트를 기록하고 봉투를 돌려줌 (seq는 여행마다 이어짐, 한 회의는 한 곳에서만 기록하므로 순서대로 증가) */
export function eventRecorder(db: Db, tripId: string, meetingId: string) {
  let next: number | null = null;
  return async (e: MeetingEventDraft): Promise<MeetingEnvelope> => {
    if (next === null) {
      const [row] = await db.select({ seq: sql<number>`coalesce(max(${meetingEvents.seq}), 0)` }).from(meetingEvents).where(eq(meetingEvents.tripId, tripId));
      next = Number(row.seq) + 1;
    }
    if (isLlmTrace(e.type)) throw new Error('LLM 과정 이벤트는 기록하지 않음');
    const seq = next++;
    const at = new Date();
    await db.insert(meetingEvents).values({ tripId, seq, meetingId, type: e.type, data: e.data, at });
    return { type: e.type, tripId, seq, at: nowKst(at), data: e.data };
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

/** 끝난 지 keepDays일이 지난 회의의 단계 기록(체크포인트)을 지움. 회의 행·이벤트는 여행과 함께 남음 */
export async function pruneMeetingCheckpoints(db: Db, checkpointer: BaseCheckpointSaver, keepDays: number): Promise<number> {
  const before = new Date(Date.now() - keepDays * 86400000);
  const old = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(inArray(meetings.status, ['done', 'failed']), lt(meetings.finishedAt, before)));
  for (const m of old) await checkpointer.deleteThread(m.id);
  return old.length;
}
