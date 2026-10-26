import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { MAX_MEMBERS, members, personas, trips } from '../db/schema.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { hashToken, newId, newInviteCode, newToken } from '../lib/ids.js';
import { parseBody } from '../lib/validate.js';
import { DestinationError, resolveDestination } from '../meeting/regions.js';
import { DEMO_SEEDS, seedPersona } from '../persona/seeds.js';
import { todayKst } from '../lib/time.js';
import { memberView, tripView } from './views.js';

/** 입력 길이 상한 (명세서 4.2) */
const TITLE_MAX = 40;
const NICKNAME_MAX = 20;

const nickname = z.string().trim().min(1, '닉네임을 입력해야 함').max(NICKNAME_MAX, `닉네임은 ${NICKNAME_MAX}자 이하여야 함`);
const createTripBody = z.object({
  title: z.string().trim().min(1, '여행 이름을 입력해야 함').max(TITLE_MAX, `여행 이름은 ${TITLE_MAX}자 이하여야 함`),
  nickname,
  demoMode: z.boolean().default(false),
});
const joinBody = z.object({ nickname });

/** 회의 조건 입력 상한 (명세서 4.4) */
const DESTINATION_MAX = 30;
const TRANSPORT_MAX = 40;
const BUDGET_MAX = 10_000_000;
/** 한 번의 회의로 짜는 여행 일수 상한 */
export const MAX_TRIP_DAYS = 3;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 함');
const realDay = (d: string) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const conditionsBody = z
  .object({
    destination: z.string().trim().min(1, '목적지를 입력해야 함').max(DESTINATION_MAX, `목적지는 ${DESTINATION_MAX}자 이하여야 함`),
    startDate: ymd,
    endDate: ymd,
    budgetPerPerson: z.number().int().min(0).max(BUDGET_MAX).nullable().default(null),
    transport: z.string().trim().max(TRANSPORT_MAX, `이동 수단은 ${TRANSPORT_MAX}자 이하여야 함`).nullable().default(null),
    moveMode: z.enum(['transit', 'car'], { message: '현지 이동 수단은 transit(대중교통) 또는 car(자차)여야 함' }).default('transit'),
    rules: z
      .object({ aiMinSatisfaction: z.number().min(1).max(10).default(7), maxRounds: z.number().int().min(1).max(5).default(5) })
      .default({ aiMinSatisfaction: 7, maxRounds: 5 }),
  })
  .refine((b) => realDay(b.startDate) && realDay(b.endDate), { message: '없는 날짜임' })
  .refine((b) => b.endDate >= b.startDate, { message: '끝나는 날은 시작하는 날과 같거나 뒤여야 함' })
  .refine((b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) / 86400000 + 1 <= MAX_TRIP_DAYS, { message: `여행은 ${MAX_TRIP_DAYS}일 이하여야 함` });

/** 1번 묶음: 여행 생성·초대·참여·상세 (명세서 4.2) */
export function tripRoutes(db: Db) {
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);

  // 구성원과 페르소나 유형명(없으면 null)을 참여 순서대로 가져옴
  const listMembers = async (tripId: string) =>
    (
      await db
        .select({ member: members, title: personas.title })
        .from(members)
        .leftJoin(personas, eq(personas.memberId, members.id))
        .where(eq(members.tripId, tripId))
        .orderBy(asc(members.seat))
    ).map((row) => memberView(row.member, row.title));

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
      // 시연 모드: 페르소나를 마친 가상 구성원 3명이 자동 참여함 (토큰은 만들기만 하고 버림)
      if (body.demoMode) {
        for (const [i, seed] of DEMO_SEEDS.entries()) {
          const id = newId('mem');
          await tx.insert(members).values({ id, tripId: trip.id, nickname: seed.nickname, seat: i + 2, tokenHash: hashToken(newToken()) });
          await tx.insert(personas).values(seedPersona(id, seed));
        }
      }
      return { trip, member };
    });
    return c.json({ trip: tripView(trip), member: memberView(member, null), token }, 201);
  });

  // 초대 정보·준비 현황 (인증 불필요)
  r.get('/invites/:inviteCode', async (c) => {
    const [trip] = await db
      .select()
      .from(trips)
      .where(eq(trips.inviteCode, c.req.param('inviteCode').toUpperCase()))
      .limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '초대 코드를 찾을 수 없음');
    return c.json({ trip: tripView(trip), members: await listMembers(trip.id) });
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
    return c.json({ trip: tripView(trip), member: memberView(member, null), token }, 201);
  });

  // 여행 상세: 구성원·조건·상태
  r.get('/trips/:tripId', auth, async (c) => {
    const [trip] = await db.select().from(trips).where(eq(trips.id, c.req.param('tripId'))).limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
    if (trip.id !== c.get('member').tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 조회할 수 있음');
    return c.json({ trip: tripView(trip), members: await listMembers(trip.id), conditions: trip.conditions ?? null });
  });

  // 회의 조건 저장 (방장, 회의 시작 전): 목적지 글자를 법정동 코드로 바꿔 함께 저장함
  r.put('/trips/:tripId/conditions', auth, async (c) => {
    const me = c.get('member');
    const [trip] = await db.select().from(trips).where(eq(trips.id, c.req.param('tripId'))).limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
    if (trip.id !== me.tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 바꿀 수 있음');
    if (!me.isHost) throw new ApiError('FORBIDDEN', '회의 조건은 방장만 정할 수 있음');
    if (trip.status !== 'preparing') throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작되어 조건을 바꿀 수 없음');
    const body = await parseBody(c, conditionsBody);
    if (body.startDate < todayKst()) throw new ApiError('VALIDATION_ERROR', '시작하는 날은 오늘이거나 그 뒤여야 함');
    let destination;
    try {
      destination = await resolveDestination(db, body.destination);
    } catch (err) {
      if (err instanceof DestinationError) throw new ApiError('VALIDATION_ERROR', err.message);
      throw err;
    }
    await db.update(trips).set({ conditions: body, regionCode: destination.regionCode, districtCodes: destination.districtCodes }).where(eq(trips.id, trip.id));
    return c.json({ conditions: body, destination: { regionCode: destination.regionCode, label: destination.label } });
  });

  return r;
}
