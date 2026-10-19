import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { meetings } from '../db/schema.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { tunnelIp } from '../lib/rate-limit.js';
import type { LlmClient } from '../llm/client.js';
import { type MeetingStateType, buildMeetingGraph, loadMeetingInput, meetingGraphShape } from '../meeting/graph.js';
import { reactionScore } from '../meeting/react.js';
import { type MeetingEventDraft, type MeetingLimits, eventRecorder, eventsAfter, finishMeeting, isLlmTrace, startMeeting } from '../meeting/runs.js';
import type { TourClient } from '../tour/client.js';

export interface MeetingDevDeps {
  db: Db;
  crowdClient: TourClient | null;
  llm: LlmClient | null;
  limits: MeetingLimits;
  checkpointer: BaseCheckpointSaver;
  /** true이면 터널(외부) 요청도 받음 (DEV_UI_TUNNEL, 팀원 확인 기간에만) */
  allowTunnel?: boolean;
}

/**
 * 회의 엔진 시험 경로 (시험 화면 /dev/meeting 전용, DEV_UI=true일 때만 열림)
 * 실제 외부 API(집중률)·LLM을 부르므로 터널(외부)로 들어온 요청은 막고 이 PC에서만 씀 (allowTunnel이면 터널 요청도 받음)
 */
export function meetingDevRoutes({ db, crowdClient, llm, limits, checkpointer, allowTunnel = false }: MeetingDevDeps) {
  const r = new Hono<AuthEnv>();
  // 그래프는 서버가 켜질 때 한 번만 만듦 (요청마다 다시 만들지 않음)
  const upToRetrieve = buildMeetingGraph({ db, crowdClient }, { upTo: 'retrieve' });
  const meetingGraph = buildMeetingGraph({ db, crowdClient, llm, limits, checkpointer, traceLlm: true });
  r.use('/dev/*', async (c, next) => {
    if (!allowTunnel && tunnelIp(c)) throw new ApiError('FORBIDDEN', '시험용 경로는 이 PC에서만 쓸 수 있음');
    await next();
  });

  // 그래프 칸: 실제 회의 그래프의 구조 (실행하지 않음, 외부 호출 없음)
  r.get('/dev/meeting/graph', async (c) => c.json(await meetingGraphShape()));

  // 1–2단계 실행: 준비 → 후보 찾기 (LLM 0회). 노드마다 지난 순서와 걸린 시간을 함께 돌려줌
  r.post('/dev/meeting/retrieve', requireMember(db), async (c) => {
    const started = Date.now();
    const trace: { node: string; ms: number }[] = [];
    let state: MeetingStateType | null = null;
    let mark = started;
    const stream = await upToRetrieve.stream({ tripId: c.get('member').tripId, meetingId: null }, { streamMode: ['updates', 'values'] });
    for await (const [mode, chunk] of stream) {
      if (mode === 'values') state = chunk as MeetingStateType;
      else for (const node of Object.keys(chunk)) {
        trace.push({ node, ms: Date.now() - mark });
        mark = Date.now();
      }
    }
    return c.json({
      ms: Date.now() - started,
      trace,
      members: state!.members.map((m) => ({ memberId: m.memberId, nickname: m.nickname, title: m.title })),
      retrieve: state!.pool,
    });
  });

  // 이 여행의 회의 실행 목록과 남은 횟수
  r.get('/dev/meeting/runs', requireMember(db), async (c) => {
    const rows = await db.select().from(meetings).where(eq(meetings.tripId, c.get('member').tripId)).orderBy(asc(meetings.runNo));
    return c.json({ runs: rows, limit: limits.runsPerTrip, llmCallsPerRun: limits.llmCallsPerRun });
  });

  // 다시 접속한 화면: afterSeq 뒤의 이벤트 (명세서 WebSocket 봉투와 같은 형식)
  r.get('/dev/meeting/events', requireMember(db), async (c) => {
    const afterSeq = Number(c.req.query('afterSeq') ?? 0) || 0;
    return c.json({ events: await eventsAfter(db, c.get('member').tripId, afterSeq) });
  });

  /**
   * 1–4단계 실행 (준비 → 후보 찾기 → 고르기 ×4 → 후보 보드 → 반응·안건). 결과를 한 줄씩 바로 보냄 (application/x-ndjson)
   * 줄 종류: event(명세서 봉투, DB에 기록) · llm(LLM 요청·받는 글자·응답, 기록하지 않음) · node(노드가 끝남) · result · error
   * 화면이 닫혀도 회의는 끝까지 진행하고 기록함 (LLM을 이미 부른 결과를 버리지 않음)
   */
  r.post('/dev/meeting/run', requireMember(db), async (c) => {
    const tripId = c.get('member').tripId;
    await loadMeetingInput(db, tripId); // 조건·성향이 준비되지 않았으면 실행 횟수를 쓰기 전에 오류
    const meeting = await startMeeting(db, tripId, limits);
    const record = eventRecorder(db, tripId, meeting.id);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (line: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          } catch {
            open = false; // 화면이 닫힘: 보내기만 멈추고 회의는 계속함
          }
        };
        const started = Date.now();
        let mark = started;
        let state: MeetingStateType | null = null;
        try {
          send({ kind: 'meeting', meetingId: meeting.id, runNo: meeting.runNo, limit: limits.runsPerTrip });
          const stream = await meetingGraph.stream(
            { tripId, meetingId: meeting.id },
            { configurable: { thread_id: meeting.id }, streamMode: ['custom', 'updates', 'values'], subgraphs: false },
          );
          for await (const [mode, chunk] of stream) {
            if (mode === 'custom') {
              const e = chunk as MeetingEventDraft;
              if (isLlmTrace(e.type)) send({ kind: 'llm', type: e.type, data: e.data });
              else send({ kind: 'event', event: await record(e) });
            }
            else if (mode === 'values') state = chunk as MeetingStateType;
            else for (const node of Object.keys(chunk)) {
              send({ kind: 'node', node, ms: Date.now() - mark });
              mark = Date.now();
            }
          }
          await finishMeeting(db, meeting.id, 'done');
          const [row] = await db.select({ llmCalls: meetings.llmCalls }).from(meetings).where(eq(meetings.id, meeting.id));
          send({ kind: 'result', ms: Date.now() - started, llmCalls: row.llmCalls, members: state!.members.map((m) => ({ memberId: m.memberId, nickname: m.nickname, title: m.title, color: m.color })), picks: state!.picks, board: state!.board, scores: state!.board!.candidates.map((c) => ({ placeId: c.placeId, ...reactionScore(c) })), retrieve: state!.pool });
        } catch (err) {
          await finishMeeting(db, meeting.id, 'failed');
          console.error('회의 실행 실패:', err);
          send({ kind: 'error', message: err instanceof ApiError ? err.message : '회의 실행 중 오류' });
        }
        if (open) controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  });
  return r;
}
