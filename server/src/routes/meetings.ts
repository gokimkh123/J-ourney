import { upgradeWebSocket } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { members, trips } from '../db/schema.js';
import { type AccessKey, requireGrant } from '../lib/access.js';
import { type AuthEnv, type Member, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { hashToken } from '../lib/ids.js';
import { parseBody } from '../lib/validate.js';
import { type EventHub, LIVE, streamTrip } from '../meeting/live.js';
import type { Monitor } from '../lib/monitor.js';
import { REACT } from '../meeting/react.js';
import { eventsAfter } from '../meeting/runs.js';
import type { MeetingService } from '../meeting/service.js';

/** 요청에 오는 id(mtg_·mem_·plc_) 글자 수 상한 (시험 경로도 같이 씀) */
export const ID_MAX = 40;
const reviewBody = z.object({
  /** 시연 모드에서 방장이 가상 구성원 몫을 대신 낼 때만 */
  memberId: z.string().max(ID_MAX).optional(),
  choices: z.array(z.object({ placeId: z.string().min(1).max(ID_MAX), keep: z.boolean() })).min(1).max(REACT.agendaMax),
});
const afterSeqOf = (raw: string | undefined) => {
  const n = Number(raw ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export interface MeetingRouteDeps {
  db: Db;
  service: MeetingService;
  hub: EventHub;
  /** 시험에서 ping 간격을 줄일 때만 (기본 명세서 25초) */
  pingMs?: number;
  /** 접근 키 (ACCESS_KEYS): 있으면 터널 요청은 맞는 키를 낸 경우만 회의를 시작함 */
  accessKeys?: readonly AccessKey[];
  /** 관리자 디버깅 화면(/dev/monitor)에 WebSocket 열림·닫힘을 남김 (시험 화면을 켠 서버만) */
  monitor?: Monitor | null;
}

/**
 * 회의 API (명세서 4.5·5장): 회의 시작 · 상태 · 사람 확인(5단계) · 놓친 이벤트 · 실시간 연결(WebSocket)
 * 앱 → 서버는 일반 요청(REST), 서버 → 앱은 WebSocket으로 기록한 이벤트를 바로 보냄
 */
export function meetingRoutes({ db, service, hub, pingMs, accessKeys = [], monitor = null }: MeetingRouteDeps) {
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);

  // 경로의 여행이 내 여행인지 확인 (없는 여행은 404, 다른 여행은 403)
  async function ownTrip(tripId: string, me: Member) {
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
    if (trip.id !== me.tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 쓸 수 있음');
    return trip;
  }

  // 회의 시작 (방장): 바로 202를 돌려주고 회의는 뒤에서 진행하며 이벤트로 알림
  r.post('/trips/:tripId/meetings', auth, async (c) => {
    const me = c.get('member');
    const trip = await ownTrip(c.req.param('tripId'), me);
    if (!me.isHost) throw new ApiError('FORBIDDEN', '회의는 방장만 시작할 수 있음');
    const access = requireGrant(c, accessKeys);
    const { meeting } = await service.start(trip.id, { official: true, access });
    return c.json({ meeting: { id: meeting.id, status: 'researching', maxRounds: trip.conditions?.rules.maxRounds ?? null } }, 202);
  });

  // 회의 상태·사람 확인 현황
  r.get('/meetings/:meetingId', auth, async (c) => c.json({ meeting: await service.view(c.req.param('meetingId'), c.get('member')) }));

  // 5단계 사람 확인: 안건마다 남김·뺌 (다시 내면 덮어씀, 4명이 모두 내면 바로 마감)
  r.post('/meetings/:meetingId/review', auth, async (c) => {
    const me = c.get('member');
    const body = await parseBody(c, reviewBody);
    await service.submitReview(c.req.param('meetingId'), me, body);
    return c.json({ meeting: await service.view(c.req.param('meetingId'), me) });
  });

  // 5단계 마감 (방장 '진행'): 응답하지 않은 사람은 남김으로 셈
  r.post('/meetings/:meetingId/review/close', auth, async (c) => {
    const me = c.get('member');
    await service.closeReview(c.req.param('meetingId'), me);
    return c.json({ meeting: await service.view(c.req.param('meetingId'), me) });
  });

  // 놓친 이벤트 (WebSocket과 같은 형식)
  r.get('/trips/:tripId/events', auth, async (c) => {
    const trip = await ownTrip(c.req.param('tripId'), c.get('member'));
    return c.json({ events: await eventsAfter(db, trip.id, afterSeqOf(c.req.query('afterSeq'))) });
  });

  /**
   * 실시간 연결: wss://{host}/api/v1/trips/{tripId}/ws?token={token}&afterSeq={n}
   * 토큰으로 그 여행 구성원만 받음 → afterSeq 뒤 이벤트를 먼저 보내고 새 이벤트를 이어서 보냄 · 25초마다 ping · 앱이 보내는 글은 이번 단계에서 받지 않음
   * 토큰이 주소에 있으므로 요청 주소를 로그에 남기지 않음
   */
  r.get(
    '/trips/:tripId/ws',
    async (c, next) => {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') throw new ApiError('VALIDATION_ERROR', 'WebSocket으로 접속해야 함');
      const token = c.req.query('token');
      if (!token) throw new ApiError('UNAUTHORIZED', '인증 토큰이 필요함');
      const [member] = await db.select().from(members).where(eq(members.tokenHash, hashToken(token))).limit(1);
      if (!member) throw new ApiError('UNAUTHORIZED', '유효하지 않은 토큰임');
      await ownTrip(c.req.param('tripId'), member);
      c.set('member', member);
      await next();
    },
    upgradeWebSocket((c) => {
      const member = c.get('member') as Member;
      const afterSeq = afterSeqOf(c.req.query('afterSeq'));
      let stop = () => {};
      let unregister = () => {};
      let watched: ReturnType<Monitor['socketOpened']> | null = null;
      return {
        onOpen(_e, ws) {
          watched = monitor?.socketOpened(c, { tripId: member.tripId, memberId: member.id, afterSeq }) ?? null;
          const send = (text: string) => {
            try {
              ws.send(text);
              watched?.sent();
            } catch {
              stop(); // 닫히는 중이면 보내기만 멈춤
            }
          };
          unregister = hub.register(member.id, { close: () => ws.close(4000, 'replaced') }, LIVE.perMember);
          stop = streamTrip(db, hub, {
            tripId: member.tripId,
            afterSeq,
            send,
            pingMs,
            onError: (err) => {
              console.error('실시간 연결 오류:', err instanceof Error ? err.message : err);
              ws.close(1011, 'error');
            },
          });
        },
        onClose(e) {
          stop();
          unregister();
          watched?.closed(e.code, e.reason);
        },
      };
    }),
  );

  return r;
}
