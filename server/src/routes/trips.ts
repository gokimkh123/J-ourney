import { and, asc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { MAX_MEMBERS, meetings, members, personas, tripPlans, trips } from '../db/schema.js';
import { type AuthEnv, requireMember } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { hashToken, newId, newInviteCode, newToken } from '../lib/ids.js';
import { failureLimit, tunnelIp } from '../lib/rate-limit.js';
import { userOfToken, userTokenOf } from '../lib/user.js';
import { parseBody } from '../lib/validate.js';
import { CLOSE, type EventHub } from '../meeting/live.js';
import { activeMeetingOf } from '../meeting/runs.js';
import type { LlmClient } from '../llm/client.js';
import type { LlmRecorder } from '../llm/record.js';
import { tryConsumeLlmCall } from '../llm/usage.js';
import { type AccessKey, accessOf, aiFor } from '../lib/access.js';
import { DestinationError, DestinationUnavailable, resolveDestination } from '../meeting/destination.js';
import { MEETING_RULES } from '../meeting/rounds.js';
import { dayTripSpanMinutes, FLIGHT } from '../meeting/schedule.js';
import { DEMO_SEEDS, seedPersona } from '../persona/seeds.js';
import { DAY_MS, todayKst } from '../lib/time.js';
import { memberView, tripView } from './views.js';

/** 입력 길이 상한 (명세서 4.2) */
const TITLE_MAX = 40;
const NICKNAME_MAX = 20;
/** IP 하나가 1분에 틀릴 수 있는 초대 코드 수 (넘으면 그 1분 동안 초대 조회·참여를 막음, 6자리 코드 맞추기 방지) */
const INVITE_MISSES_PER_MINUTE = 20;
/** 새 초대 코드가 이미 쓰였으면 다시 만드는 횟수 */
const INVITE_CODE_TRIES = 5;

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
/** 방장 질문 입력 상한 (v2.4): 이미 예약한 장소 수(사람마다 가고 싶은 곳과 같은 3곳) · 이름 글자 수 */
const BOOKED = { places: 3, nameMax: 40 } as const;
const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:MM (00:00–23:59) 형식이어야 함');
const bookedName = z.string().trim().min(1, '이름을 입력해야 함').max(BOOKED.nameMax, `이름은 ${BOOKED.nameMax}자 이하여야 함`);
const R = MEETING_RULES;
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
      .object({
        aiMinSatisfaction: z.number().min(R.aiMinSatisfaction.min).max(R.aiMinSatisfaction.max).default(R.aiMinSatisfaction.default),
        maxRounds: z.number().int().min(R.maxRounds.min).max(R.maxRounds.max).default(R.maxRounds.default),
      })
      .default({ aiMinSatisfaction: R.aiMinSatisfaction.default, maxRounds: R.maxRounds.default }),
    // 방장 질문 (v2.4): 항공편·열차 도착·출발 시각, 이미 예약한 숙소·장소
    arrivalTime: hhmm.nullable().default(null),
    departureTime: hhmm.nullable().default(null),
    bookedLodging: bookedName.nullable().default(null),
    bookedPlaces: z.array(bookedName).max(BOOKED.places, `이미 예약한 장소는 ${BOOKED.places}곳까지`).default([]),
  })
  .refine((b) => realDay(b.startDate) && realDay(b.endDate), { message: '없는 날짜임' })
  .refine((b) => b.endDate >= b.startDate, { message: '끝나는 날은 시작하는 날과 같거나 뒤여야 함' })
  .refine((b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) / DAY_MS + 1 <= MAX_TRIP_DAYS, { message: `여행은 ${MAX_TRIP_DAYS}일 이하여야 함` })
  .refine((b) => b.startDate !== b.endDate || !b.arrivalTime || !b.departureTime || dayTripSpanMinutes(b.arrivalTime, b.departureTime) > 0, {
    message: `당일치기는 도착 ${FLIGHT.arrivalBufferMinutes}분 뒤부터 출발 ${FLIGHT.departureBufferMinutes}분 전 사이에 다닐 시간이 있어야 함`,
  });

/**
 * 여행지 확인에 쓰는 LLM (10/29: 방장이 쓴 여행지 글은 LLM이 공식 지역 목록에서 고름, destination.ts)
 * 접근 키가 있는 서버에서 키 없는 바깥 요청은 LLM을 부르지 않고 녹화된 같은 글의 답만 씀 (성향 카드와 같은 규칙), 키를 낸 요청은 live
 */
export interface TripDeps {
  llm: LlmClient | null;
  recorder?: LlmRecorder | null;
  live?: { llm: LlmClient; recorder: LlmRecorder } | null;
  llmDailyLimit: number;
  accessKeys?: readonly AccessKey[];
  /** 나가기·여행 삭제 때 그 사람의 실시간 연결을 닫음 (v2.4) */
  hub?: EventHub;
  /** 여행 삭제 때 그 여행 회의들의 단계 기록(체크포인트)을 지움 (v2.4) */
  forgetMeetings?: (meetingIds: readonly string[]) => Promise<void>;
  /** true이면 바깥(터널) 요청은 카카오 로그인 토큰을 내야 여행 만들기·참여 (LOGIN_REQUIRED, 11/2) */
  loginRequired?: boolean;
}

/** 1번 묶음: 여행 생성·초대·참여·상세 (명세서 4.2) */
export function tripRoutes(db: Db, deps: TripDeps) {
  const r = new Hono<AuthEnv>();
  const auth = requireMember(db);
  const inviteMisses = failureLimit(INVITE_MISSES_PER_MINUTE);

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
    for (let i = 0; i < INVITE_CODE_TRIES; i++) {
      const code = newInviteCode();
      const [taken] = await db.select({ id: trips.id }).from(trips).where(eq(trips.inviteCode, code)).limit(1);
      if (!taken) return code;
    }
    throw new Error('초대 코드 생성 실패');
  }

  // 카카오 로그인 (11/2): 로그인 토큰(usr_)을 내면 그 계정에 자리를 묶음(내 여행 되찾기). LOGIN_REQUIRED면 바깥(터널) 요청은 로그인해야 만들기·참여 (서버 안 요청은 예전처럼)
  const loginOf = async (c: Context) => {
    const token = userTokenOf(c);
    const user = token ? await userOfToken(db, token) : null;
    if (token && !user) throw new ApiError('UNAUTHORIZED', '로그인이 만료되었거나 유효하지 않음');
    if (!user && deps.loginRequired && tunnelIp(c) !== null) throw new ApiError('LOGIN_REQUIRED', '카카오 로그인이 필요함');
    return user;
  };

  // 여행 생성: 만든 사람이 방장(1번 자리)이 됨
  r.post('/trips', async (c) => {
    const user = await loginOf(c);
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
        .values({ id: newId('mem'), tripId: trip.id, userId: user?.id ?? null, nickname: body.nickname, seat: 1, isHost: true, tokenHash: hashToken(token) })
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
    inviteMisses.check(c);
    const [trip] = await db
      .select()
      .from(trips)
      .where(eq(trips.inviteCode, c.req.param('inviteCode').toUpperCase()))
      .limit(1);
    if (!trip) {
      inviteMisses.fail(c);
      throw new ApiError('NOT_FOUND', '초대 코드를 찾을 수 없음');
    }
    return c.json({ trip: tripView(trip), members: await listMembers(trip.id) });
  });

  // 여행 참여 (인증 불필요): 방장 포함 최대 4명, 회의를 시작하기 전까지만
  r.post('/invites/:inviteCode/join', async (c) => {
    inviteMisses.check(c);
    const user = await loginOf(c);
    const body = await parseBody(c, joinBody);
    const token = newToken();
    const { trip, member, again } = await db.transaction(async (tx) => {
      // 동시에 참여해도 인원 상한을 넘지 않도록 여행 행을 잠근 뒤 인원을 셈 (회의 시작도 같은 행을 잠가 차례로 돎)
      const [trip] = await tx
        .select()
        .from(trips)
        .where(eq(trips.inviteCode, c.req.param('inviteCode').toUpperCase()))
        .for('update');
      if (!trip) return { trip: null, member: null, again: false };
      // 이미 이 여행에 자리가 있는 계정은 새 자리 대신 그 자리를 다시 줌 (토큰은 새로, 예전 토큰은 더 쓰지 못함)
      if (user) {
        const [again] = await tx
          .update(members)
          .set({ tokenHash: hashToken(token) })
          .where(and(eq(members.tripId, trip.id), eq(members.userId, user.id)))
          .returning();
        if (again) return { trip, member: again, again: true };
      }
      // 회의를 시작한 뒤 들어온 사람은 회의·사람 확인(인원수)에 들어가지 않으므로 받지 않음 (시험 경로 회의는 여행 상태를 바꾸지 않아 진행 중인 회의도 봄)
      if (trip.status !== 'preparing' || (await activeMeetingOf(tx, trip.id))) throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작된 여행에는 참여할 수 없음');
      // 회의가 끝나 일정 표(14·15단계)가 열린 여행도 받지 않음: 고르기·확정 투표의 인원수가 바뀜 (시험 경로 여행은 상태가 preparing으로 남음)
      if ((await tx.select({ id: tripPlans.tripId }).from(tripPlans).where(eq(tripPlans.tripId, trip.id))).length)
        throw new ApiError('MEETING_IN_PROGRESS', '회의가 끝나 일정 표가 열린 여행에는 참여할 수 없음');
      const joined = await tx.select({ id: members.id, seat: members.seat }).from(members).where(eq(members.tripId, trip.id));
      if (joined.length >= MAX_MEMBERS) {
        throw new ApiError('TRIP_FULL', `참가 인원이 가득 참 (방장 포함 최대 ${MAX_MEMBERS}명)`);
      }
      // 비어 있는 가장 앞 자리 (나간 사람의 자리를 다시 씀, v2.4 — 자리 번호는 여행 안에서 겹치지 않음)
      const taken = new Set(joined.map((j) => j.seat));
      const seat = Array.from({ length: MAX_MEMBERS }, (_, i) => i + 1).find((n) => !taken.has(n))!;
      const [member] = await tx
        .insert(members)
        .values({ id: newId('mem'), tripId: trip.id, userId: user?.id ?? null, nickname: body.nickname, seat, tokenHash: hashToken(token) })
        .returning();
      return { trip, member, again: false };
    });
    if (!trip || !member) {
      inviteMisses.fail(c);
      throw new ApiError('NOT_FOUND', '초대 코드를 찾을 수 없음');
    }
    if (again) {
      deps.hub?.closeMember(member.id, CLOSE.replaced);
      const [persona] = await db.select({ title: personas.title }).from(personas).where(eq(personas.memberId, member.id)).limit(1);
      return c.json({ trip: tripView(trip), member: memberView(member, persona?.title ?? null), token }, 200);
    }
    return c.json({ trip: tripView(trip), member: memberView(member, null), token }, 201);
  });

  // 여행 상세: 구성원·조건·상태
  r.get('/trips/:tripId', auth, async (c) => {
    const [trip] = await db.select().from(trips).where(eq(trips.id, c.req.param('tripId'))).limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
    if (trip.id !== c.get('member').tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 조회할 수 있음');
    return c.json({ trip: tripView(trip), members: await listMembers(trip.id), conditions: trip.conditions ?? null });
  });

  // 회의 조건 저장 (방장, 회의 시작 전): 방장이 쓴 여행지를 LLM이 공식 지역 목록에서 골라 법정동 코드로 함께 저장함 (코드는 글자를 비교하지 않음)
  r.put('/trips/:tripId/conditions', auth, async (c) => {
    const me = c.get('member');
    const [trip] = await db.select().from(trips).where(eq(trips.id, c.req.param('tripId'))).limit(1);
    if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
    if (trip.id !== me.tripId) throw new ApiError('FORBIDDEN', '참여한 여행만 바꿀 수 있음');
    if (!me.isHost) throw new ApiError('FORBIDDEN', '회의 조건은 방장만 정할 수 있음');
    if (trip.status !== 'preparing') throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작되어 조건을 바꿀 수 없음');
    const body = await parseBody(c, conditionsBody);
    if (body.startDate < todayKst()) throw new ApiError('VALIDATION_ERROR', '시작하는 날은 오늘이거나 그 뒤여야 함');
    const keys = deps.accessKeys ?? [];
    const access = keys.length ? accessOf(c, keys) : null;
    const { llm, recorder } = aiFor(access, deps);
    let destination;
    try {
      destination = await resolveDestination(db, body.destination, { llm, recorder, reserve: () => tryConsumeLlmCall(db, deps.llmDailyLimit) });
    } catch (err) {
      if (err instanceof DestinationError) throw new ApiError('VALIDATION_ERROR', err.message);
      if (err instanceof DestinationUnavailable) throw new ApiError('AI_UNAVAILABLE', err.message);
      throw err;
    }
    // 목적지를 찾는 사이 회의가 시작됐으면 저장하지 않음 (회의 시작이 여행 행을 잠그고 상태를 바꾸므로 조건부로 저장)
    const saved = await db
      .update(trips)
      .set({ conditions: body, regionCode: destination.regionCode, districtCodes: destination.districtCodes })
      .where(and(eq(trips.id, trip.id), eq(trips.status, 'preparing')))
      .returning({ id: trips.id });
    if (!saved.length) throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작되어 조건을 바꿀 수 없음');
    return c.json({ conditions: body, destination: { regionCode: destination.regionCode, label: destination.label } });
  });

  // 파티 나가기 (v2.4, 방장 아닌 구성원): 회의를 시작하기 전까지만. 내 성향·사람 확인 응답도 함께 지움, 열린 실시간 연결은 4001로 닫음
  r.delete('/trips/:tripId/members/me', auth, async (c) => {
    const me = c.get('member');
    if (me.tripId !== c.req.param('tripId')) throw new ApiError('FORBIDDEN', '참여한 여행만 나갈 수 있음');
    if (me.isHost) throw new ApiError('FORBIDDEN', '방장은 나갈 수 없음 (파티 없애기를 씀)');
    await db.transaction(async (tx) => {
      // 참여·회의 시작과 같은 여행 행을 잠가 차례로 돎 (나가는 사이에 회의가 시작되지 않게)
      const [trip] = await tx.select().from(trips).where(eq(trips.id, me.tripId)).for('update');
      if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
      const opened = await tx.select({ id: tripPlans.tripId }).from(tripPlans).where(eq(tripPlans.tripId, trip.id));
      if (trip.status !== 'preparing' || (await activeMeetingOf(tx, trip.id)) || opened.length) throw new ApiError('MEETING_IN_PROGRESS', '회의가 시작된 여행은 나갈 수 없음');
      await tx.delete(members).where(eq(members.id, me.id));
    });
    deps.hub?.closeMember(me.id, CLOSE.left);
    return c.body(null, 204);
  });

  // 파티 없애기 (v2.4, 방장): 여행과 구성원·성향·회의·이벤트·일정 표를 모두 지움. 회의가 도는 중이면 409 (끝난 뒤 다시)
  r.delete('/trips/:tripId', auth, async (c) => {
    const me = c.get('member');
    if (me.tripId !== c.req.param('tripId')) throw new ApiError('FORBIDDEN', '참여한 여행만 지울 수 있음');
    if (!me.isHost) throw new ApiError('FORBIDDEN', '방장만 파티를 없앨 수 있음');
    const gone = await db.transaction(async (tx) => {
      const [trip] = await tx.select().from(trips).where(eq(trips.id, me.tripId)).for('update');
      if (!trip) throw new ApiError('NOT_FOUND', '여행을 찾을 수 없음');
      const runs = await tx.select({ id: meetings.id, status: meetings.status }).from(meetings).where(eq(meetings.tripId, trip.id));
      if (runs.some((m) => m.status === 'running')) throw new ApiError('MEETING_IN_PROGRESS', '회의가 진행 중이라 지울 수 없음 (회의가 끝난 뒤 다시)');
      const people = await tx.select({ id: members.id }).from(members).where(eq(members.tripId, trip.id));
      await tx.delete(trips).where(eq(trips.id, trip.id));
      return { meetingIds: runs.map((m) => m.id), memberIds: people.map((p) => p.id) };
    });
    for (const id of gone.memberIds) deps.hub?.closeMember(id, CLOSE.tripDeleted);
    await deps.forgetMeetings?.(gone.meetingIds).catch((err) => console.warn('지운 여행의 회의 기록 정리 실패:', err instanceof Error ? err.message : err));
    return c.body(null, 204);
  });

  return r;
}
