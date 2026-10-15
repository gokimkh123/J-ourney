import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { tunnelIp } from '../lib/rate-limit.js';
import { buildMeetingGraph } from '../meeting/graph.js';
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

  // 1–2단계 실행: 준비 → 후보 찾기 (LLM 0회)
  r.post('/dev/meeting/retrieve', requireMember(db), async (c) => {
    const started = Date.now();
    const state = await buildMeetingGraph({ db, crowdClient }).invoke({ tripId: c.get('member').tripId });
    return c.json({
      ms: Date.now() - started,
      members: state.members.map((m) => ({ memberId: m.memberId, nickname: m.nickname, title: m.title })),
      retrieve: state.pool,
    });
  });
  return r;
}
