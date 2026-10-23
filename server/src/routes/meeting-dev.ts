import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { MAX_MEMBERS, meetings, trips } from '../db/schema.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { tunnelIp } from '../lib/rate-limit.js';
import { parseBody } from '../lib/validate.js';
import { type MeetingStateType, buildMeetingGraph, loadMeetingInput, meetingGraphShape } from '../meeting/graph.js';
import type { EventHub } from '../meeting/live.js';
import { REACT, reactionScore } from '../meeting/react.js';
import { type MeetingLimits, eventsAfter } from '../meeting/runs.js';
import type { MeetingObserver, MeetingService, RunOutcome } from '../meeting/service.js';
import type { TourClient } from '../tour/client.js';

export interface MeetingDevDeps {
  db: Db;
  crowdClient: TourClient | null;
  limits: MeetingLimits;
  service: MeetingService;
  hub: EventHub;
  /** true이면 터널(외부) 요청도 받음 (DEV_UI_TUNNEL, 팀원 확인 기간에만) */
  allowTunnel?: boolean;
  /** LLM_REPLAY: LLM 없이 지난 결과를 다시 씀 (화면에 알리기만 함) */
  replay?: boolean;
}

const devReviewBody = z.object({
  meetingId: z.string().min(1).max(40),
  /** 구성원마다 안건별 남김·뺌 (응답하지 않은 사람은 빼고 보냄) */
  responses: z
    .array(z.object({ memberId: z.string().min(1).max(40), choices: z.array(z.object({ placeId: z.string().min(1).max(40), keep: z.boolean() })).max(REACT.agendaMax) }))
    .max(MAX_MEMBERS),
  /** true면 방장 '진행'으로 마감 (응답하지 않은 사람은 남김) */
  close: z.boolean().default(false),
});

/** 한 줄씩 보내는 응답 (application/x-ndjson). 화면이 닫혀도 회의는 끝까지 진행하고 기록함 */
function ndjson() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });
  const send = (line: unknown) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    } catch {
      open = false; // 화면이 닫힘: 보내기만 멈추고 회의는 계속함
    }
  };
  const end = () => {
    if (!open) return;
    open = false;
    controller.close();
  };
  const response = () => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  return { send, end, response };
}

/**
 * 회의 엔진 시험 경로 (시험 화면 /dev/meeting 전용, DEV_UI=true일 때만 열림)
 * 실제 외부 API(집중률)·LLM을 부르므로 터널(외부)로 들어온 요청은 막고 이 PC에서만 씀 (allowTunnel이면 터널 요청도 받음)
 */
export function meetingDevRoutes({ db, crowdClient, limits, service, hub, allowTunnel = false, replay = false }: MeetingDevDeps) {
  const r = new Hono<AuthEnv>();
  // 1–2단계만 보는 그래프는 서버가 켜질 때 한 번만 만듦 (요청마다 다시 만들지 않음)
  const upToRetrieve = buildMeetingGraph({ db, crowdClient }, { upTo: 'retrieve' });
  r.use('/dev/*', async (c, next) => {
    if (!allowTunnel && tunnelIp(c)) throw new ApiError('FORBIDDEN', '시험용 경로는 이 PC에서만 쓸 수 있음');
    await next();
  });

  // 실행 방식: LLM_REPLAY면 LLM 없이 지난 결과를 다시 씀 (화면 안내용)
  r.get('/dev/meeting/mode', (c) => c.json({ replay }));

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

  /** 실행이 끝나면 보내는 마지막 줄: 1–4단계 결과와, 멈췄으면 사람 확인 요청 */
  async function resultLine(meetingId: string, out: RunOutcome, started: number) {
    const [row] = await db.select({ llmCalls: meetings.llmCalls }).from(meetings).where(eq(meetings.id, meetingId));
    const s = out.state!;
    return {
      kind: 'result',
      meetingId,
      status: out.status,
      ms: Date.now() - started,
      llmCalls: row.llmCalls,
      members: s.members.map((m) => ({ memberId: m.memberId, nickname: m.nickname, title: m.title, color: m.color })),
      picks: s.picks,
      board: s.board,
      scores: s.board!.candidates.map((c) => ({ placeId: c.placeId, ...reactionScore(c) })),
      retrieve: s.pool,
      review: out.status === 'reviewing' ? s.reviewRequest : null,
      reviewDecision: s.reviewDecision ?? null,
      /** LLM_REPLAY로 실행함 (고른 결과마다 savedFrom이 있으면 지난 AI 결과, 없으면 규칙) */
      replay: !!s.saved,
    };
  }
  const finish = (stream: ReturnType<typeof ndjson>, meetingId: string, started: number) => (out: RunOutcome) =>
    (out.status === 'failed'
      ? Promise.resolve(stream.send({ kind: 'error', message: out.error instanceof ApiError ? out.error.message : '회의 실행 중 오류' }))
      : resultLine(meetingId, out, started).then(stream.send)
    ).finally(stream.end);

  /**
   * 1–5단계 실행 (준비 → 후보 찾기 → 고르기 ×4 → 후보 보드 → 반응·안건 → 고를 안건이 있으면 사람 확인에서 멈춤). 결과를 한 줄씩 바로 보냄
   * 줄 종류: meeting · event(명세서 봉투, DB에 기록) · llm(LLM 요청·받는 글자·응답, 기록하지 않음) · node(노드가 끝남) · result · error
   * 시험 화면에서 다시 실행하면 사람 확인을 기다리던 이 여행의 이전 회의는 그만둠 (공식 경로는 진행 중이면 MEETING_IN_PROGRESS)
   */
  r.post('/dev/meeting/run', requireMember(db), async (c) => {
    const tripId = c.get('member').tripId;
    await loadMeetingInput(db, tripId); // 조건·성향이 준비되지 않았으면 그만두지 않고 오류
    const abandoned = await db.update(meetings).set({ status: 'failed', finishedAt: new Date() }).where(and(eq(meetings.tripId, tripId), eq(meetings.status, 'reviewing'))).returning({ id: meetings.id });
    if (abandoned.length) await db.update(trips).set({ status: 'preparing' }).where(and(eq(trips.id, tripId), eq(trips.status, 'meeting')));
    const stream = ndjson();
    const started = Date.now();
    const observer: MeetingObserver = {
      event: (e) => stream.send({ kind: 'event', event: e }),
      trace: (e) => stream.send({ kind: 'llm', type: e.type, data: e.data }),
      node: (node, ms) => stream.send({ kind: 'node', node, ms }),
    };
    const { meeting, done } = await service.start(tripId, {
      observer,
      onStart: (m) => stream.send({ kind: 'meeting', meetingId: m.id, runNo: m.runNo, limit: limits.runsPerTrip }),
    });
    void done.then(finish(stream, meeting.id, started)).catch((err) => console.error('시험 경로 결과 전송 실패:', err));
    return stream.response();
  });

  /**
   * 5단계 시험: 4명 몫의 남김·뺌을 방장이 대신 내고(시연 여행) 마감하면 이어서 실행한 결과를 한 줄씩 보냄
   * 이벤트(review.cast·review.closed·board.updated)는 실시간 연결과 같은 길(허브)로 받아 그대로 보냄
   */
  r.post('/dev/meeting/review', requireMember(db), async (c) => {
    const me = c.get('member');
    const body = await parseBody(c, devReviewBody);
    const stream = ndjson();
    const started = Date.now();
    const unsubscribe = hub.subscribe(me.tripId, (e) => stream.send({ kind: 'event', event: e }));
    const observer: MeetingObserver = { node: (node, ms) => stream.send({ kind: 'node', node, ms }) };
    let done: Promise<RunOutcome> | null = null;
    try {
      for (const x of body.responses) done = (await service.submitReview(body.meetingId, me, { memberId: x.memberId, choices: x.choices }, observer)).done ?? done;
      if (!done && body.close) done = (await service.closeReview(body.meetingId, me, observer)).done;
    } catch (err) {
      unsubscribe();
      throw err;
    }
    if (done)
      void done
        .then(finish(stream, body.meetingId, started))
        .finally(unsubscribe)
        .catch((err) => console.error('시험 경로 결과 전송 실패:', err));
    else {
      unsubscribe();
      stream.send({ kind: 'result', meetingId: body.meetingId, status: 'reviewing', meeting: await service.view(body.meetingId, me) });
      stream.end();
    }
    return stream.response();
  });

  return r;
}
