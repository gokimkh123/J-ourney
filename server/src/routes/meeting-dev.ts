import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { tunnelIp } from '../lib/rate-limit.js';
import { type MeetingStateType, buildMeetingGraph, meetingGraphShape } from '../meeting/graph.js';
import type { TourClient } from '../tour/client.js';

/**
 * 회의 엔진 시험 경로 (시험 화면 /dev/meeting 전용, DEV_UI=true일 때만 열림)
 * 실제 외부 API(집중률)를 부르므로 터널(외부)로 들어온 요청은 막고 이 PC에서만 씀
 */
export function meetingDevRoutes({ db, crowdClient }: { db: Db; crowdClient: TourClient | null }) {
  const r = new Hono<AuthEnv>();
  r.use('/dev/*', async (c, next) => {
    if (tunnelIp(c)) throw new ApiError('FORBIDDEN', '시험용 경로는 이 PC에서만 쓸 수 있음');
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
    const stream = await buildMeetingGraph({ db, crowdClient }).stream({ tripId: c.get('member').tripId }, { streamMode: ['updates', 'values'] });
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
  return r;
}
