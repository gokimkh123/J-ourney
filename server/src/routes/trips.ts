import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { MAX_MEMBERS, members, trips } from '../db/schema.js';
import { type AuthEnv, type Member, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { hashToken, newId, newInviteCode, newToken } from '../lib/ids.js';
import { parseBody } from '../lib/validate.js';

/** 구성원 색상: 참여 순서대로 배정 (명세서 3장) */
export const MEMBER_COLORS = ['#F97316', '#EC4899', '#0EA5E9', '#10B981'] as const;

type Trip = typeof trips.$inferSelect;

const tripView = (t: Trip) => ({ id: t.id, title: t.title, inviteCode: t.inviteCode, status: t.status });

// 페르소나는 2번 묶음에서 연결하므로 지금은 항상 '준비 전'으로 응답함
const memberView = (m: Member) => ({
  id: m.id,
  nickname: m.nickname,
  color: MEMBER_COLORS[m.seat - 1],
  isHost: m.isHost,
  personaReady: false,
  mbti: null,
});

/** 입력 길이 상한 (명세서 4.2) */
const TITLE_MAX = 40;
const NICKNAME_MAX = 20;

const nickname = z.string().trim().min(1, '닉네임을 입력해야 함').max(NICKNAME_MAX, `닉네임은 ${NICKNAME_MAX}자 이하여야 함`);
const createTripBody = z.object({
  title: z.string().trim().min(1, '여행 이름을 입력해야 함').max(TITLE_MAX, `여행 이름은 ${TITLE_MAX}자 이하여야 함`),
  nickname,
  demoMode: z.boolean().default(false), // 시드 구성원 자동 참여는 페르소나가 생기는 2번 묶음에서 연결
});
const joinBody = z.object({ nickname });

/** 1번 묶음: 여행 생성·초대·참여·상세 (명세서 4.2) */
export function tripRoutes(db: Db) {
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);

  const listMembers = (tripId: string) =>
    db.select().from(members).where(eq(members.tripId, tripId)).orderBy(asc(members.seat));

  async function unusedInviteCode() {
    for (let i = 0; i < 5; i++) {
      const code = newInviteCode();
      const [taken] = await db.select({ id: trips.id }).from(trips).where(eq(trips.inviteCode, code)).limit(1);
      if (!taken) return code;
    }
    throw new Error('초대 코드 생성 실패');
  }

  // 여행 생성: 만든 사람이 방장(1번 자리)이 됨
  r.post('/trips', async (c) => {
    const body = await parseBody(c, createTripBody);
    const inviteCode = await unusedInviteCode();
    const token = newToken();
    const { trip, member } = await db.transaction(async (tx) => {
      const [trip] = await tx
        .insert(trips)
        .values({ id: newId('trp'), title: body.title, inviteCode, demoMode: body.demoMode })
        .returning();
      const [member] = await tx
        .insert(members)
        .values({ id: newId('mem'), tripId: trip.id, nickname: body.nickname, seat: 1, isHost: true, tokenHash: hashToken(token) })
        .returning();
      return { trip, member };
    });
    return c.json({ trip: tripView(trip), member: memberView(member), token }, 201);
  });

  // 초대 정보·준비 현황 (인증 불필요)
  r.get('/invites/:inviteCode', async (c) => {
    const [trip] = await db
      .select()
      .from(trips)
      .where(eq(trips.inviteCode, c.req.param('inviteCode').toUpperCase()))
      .limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '초대 코드를 찾을 수 없음');
    return c.json({ trip: tripView(trip), members: (await listMembers(trip.id)).map(memberView) });
  });

  // 여행 참여 (인증 불필요): 방장 포함 최대 4명
  r.post('/invites/:inviteCode/join', async (c) => {
    const body = await parseBody(c, joinBody);
    const token = newToken();
    const { trip, member } = await db.transaction(async (tx) => {
      // 동시에 참여해도 인원 상한을 넘지 않도록 여행 행을 잠근 뒤 인원을 셈
      const [trip] = await tx
        .select()
        .from(trips)
        .where(eq(trips.inviteCode, c.req.param('inviteCode').toUpperCase()))
        .for('update');
      if (!trip) throw new ApiError('NOT_FOUND', '초대 코드를 찾을 수 없음');
      const joined = await tx.select({ id: members.id }).from(members).where(eq(members.tripId, trip.id));
      if (joined.length >= MAX_MEMBERS) {
        throw new ApiError('TRIP_FULL', `참가 인원이 가득 참 (방장 포함 최대 ${MAX_MEMBERS}명)`);
      }
      const [member] = await tx
        .insert(members)
        .values({ id: newId('mem'), tripId: trip.id, nickname: body.nickname, seat: joined.length + 1, tokenHash: hashToken(token) })
        .returning();
      return { trip, member };
    });
    return c.json({ trip: tripView(trip), member: memberView(member), token }, 201);
  });

  // 여행 상세: 구성원·조건·상태
  r.get('/trips/:tripId', auth, async (c) => {
    const [trip] = await db.select().from(trips).where(eq(trips.id, c.req.param('tripId'))).limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
    if (trip.id !== c.get('member').tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 조회할 수 있음');
    // 회의 조건은 3번 묶음(PUT /trips/{tripId}/conditions)에서 채움
    return c.json({ trip: tripView(trip), members: (await listMembers(trip.id)).map(memberView), conditions: null });
  });

  return r;
}
