import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { members, personas, trips, userSessions, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { hashToken, newId, newToken } from '../lib/ids.js';
import { DAY_MS, nowKst } from '../lib/time.js';
import { AUTH, type KakaoAuth, type User, userOfToken, userTokenOf } from '../lib/user.js';
import { parseBody } from '../lib/validate.js';
import { CLOSE, type EventHub } from '../meeting/live.js';
import { memberView, tripView } from './views.js';

export interface AuthDeps {
  /** 카카오 토큰 확인기 (없으면 로그인을 받지 않음) */
  kakao: KakaoAuth | null;
  /** 우리 앱의 카카오 앱 ID (KAKAO_APP_ID). 확인한 토큰의 앱 ID가 이것과 같아야 함 */
  kakaoAppId: string | null;
  /** 구성원 토큰을 새로 받으면 예전 토큰으로 열린 실시간 연결을 닫음 */
  hub?: EventHub;
}

const kakaoBody = z.object({ accessToken: z.string().trim().min(1).max(4096) });

/** 카카오 로그인 (11/2, 명세서 v2.5): 로그인 · 로그아웃 · 내 여행 목록 · 내 여행의 구성원 토큰 다시 받기 */
export function authRoutes(db: Db, deps: AuthDeps) {
  const r = new Hono();

  /** Authorization: Bearer {로그인 토큰} 확인 */
  const requireUser = async (c: Context): Promise<User> => {
    const token = userTokenOf(c);
    if (!token) throw new ApiError('UNAUTHORIZED', '로그인 토큰이 필요함');
    const user = await userOfToken(db, token);
    if (!user) throw new ApiError('UNAUTHORIZED', '로그인이 만료되었거나 유효하지 않음');
    return user;
  };

  // 로그인: 앱이 카카오 SDK로 받은 액세스 토큰 → 카카오에 확인(우리 앱에서 받은 토큰인지) → 계정(카카오 회원번호) → 우리 로그인 토큰
  r.post('/auth/kakao', async (c) => {
    const body = await parseBody(c, kakaoBody);
    if (!deps.kakao || !deps.kakaoAppId) throw new ApiError('LOGIN_UNAVAILABLE', '카카오 로그인이 설정되지 않음');
    let who: Awaited<ReturnType<KakaoAuth['verify']>>;
    try {
      who = await deps.kakao.verify(body.accessToken);
    } catch (err) {
      console.warn('카카오 로그인 확인 실패:', err instanceof Error ? err.message.slice(0, 200) : err);
      throw new ApiError('LOGIN_UNAVAILABLE', '카카오 확인을 지금 할 수 없음 (잠시 뒤 다시)');
    }
    if (!who || who.appId !== deps.kakaoAppId) throw new ApiError('UNAUTHORIZED', '카카오 로그인을 확인하지 못함');
    const token = newToken('usr');
    const expiresAt = new Date(Date.now() + AUTH.sessionDays * DAY_MS);
    const user = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ id: newId('usr'), kakaoId: who.kakaoId })
        .onConflictDoUpdate({ target: users.kakaoId, set: { lastLoginAt: new Date() } })
        .returning();
      await tx.insert(userSessions).values({ tokenHash: hashToken(token), userId: u.id, expiresAt });
      return u;
    });
    return c.json({ user: { id: user.id }, token, expiresAt: nowKst(expiresAt) });
  });

  // 로그아웃: 이 기기의 로그인 토큰만 지움 (없어도 204)
  r.delete('/auth/session', async (c) => {
    const token = userTokenOf(c);
    if (token) await db.delete(userSessions).where(eq(userSessions.tokenHash, hashToken(token)));
    return c.body(null, 204);
  });

  // 내 여행 목록: 이 계정으로 만들거나 참여한 여행 (최근 것부터)
  r.get('/users/me/trips', async (c) => {
    const user = await requireUser(c);
    const rows = await db
      .select({ trip: trips, member: members, title: personas.title })
      .from(members)
      .innerJoin(trips, eq(trips.id, members.tripId))
      .leftJoin(personas, eq(personas.memberId, members.id))
      .where(eq(members.userId, user.id))
      .orderBy(desc(members.createdAt));
    return c.json({ trips: rows.map((x) => ({ trip: tripView(x.trip), member: memberView(x.member, x.title ?? null) })) });
  });

  // 내 여행의 구성원 토큰 다시 받기 (앱을 지웠거나 폰을 바꾼 뒤): 새 토큰을 주고 예전 토큰은 더 쓰지 못함 (예전 토큰으로 열린 실시간 연결은 4000으로 닫음)
  r.post('/users/me/trips/:tripId/token', async (c) => {
    const user = await requireUser(c);
    const token = newToken();
    const [member] = await db
      .update(members)
      .set({ tokenHash: hashToken(token) })
      .where(and(eq(members.tripId, c.req.param('tripId')), eq(members.userId, user.id)))
      .returning();
    if (!member) throw new ApiError('NOT_FOUND', '내 여행에서 찾을 수 없음');
    deps.hub?.closeMember(member.id, CLOSE.replaced);
    const [trip] = await db.select().from(trips).where(eq(trips.id, member.tripId)).limit(1);
    const [persona] = await db.select({ title: personas.title }).from(personas).where(eq(personas.memberId, member.id)).limit(1);
    return c.json({ trip: tripView(trip), member: memberView(member, persona?.title ?? null), token });
  });

  return r;
}
