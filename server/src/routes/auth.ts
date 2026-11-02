import { randomBytes } from 'node:crypto';
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
  /** 브라우저 로그인 뒤 돌려보낼 수 있는 앱 주소 스킴 (KAKAO_LOGIN_RETURN_SCHEMES, 기본 journey) */
  returnSchemes?: readonly string[];
}

/** 글을 HTML에 넣을 때 바꿔 씀 (돌아갈 앱 주소는 사람이 보낸 값이라 그대로 넣지 않음) */
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * 브라우저 로그인이 끝난 뒤 보이는 화면: 앱 주소(사용자 지정 스킴)로 넘어감. 크롬이 사람의 누름 없이 앱으로 넘어가는 것을 막으면 버튼을 눌러 넘어감.
 * 주소는 버튼에만 넣고 스크립트는 버튼 주소를 읽기만 함 (사람이 보낸 값을 스크립트 안에 넣지 않음)
 */
const loginPage = (title: string, href: string | null) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>J-ourney 로그인</title><style>body{font-family:Pretendard,system-ui,sans-serif;max-width:360px;margin:12vh auto;padding:0 16px;color:#17191c;text-align:center}
a{display:block;font-size:16px;padding:14px;border-radius:12px;background:#1e2126;color:#fff;font-weight:700;text-decoration:none;margin-top:16px}</style></head>
<body><p>${esc(title)}</p>${href ? `<a id="go" href="${esc(href)}">앱으로 돌아가기</a><script>location.replace(document.getElementById('go').href)</script>` : ''}</body></html>`;

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

  /** 카카오 액세스 토큰 → 카카오에 확인(우리 앱에서 받은 토큰인지) → 계정(카카오 회원번호) → 우리 로그인 토큰 (앱 SDK 로그인·브라우저 로그인이 같이 씀) */
  const loginWithKakao = async (accessToken: string) => {
    if (!deps.kakao || !deps.kakaoAppId) throw new ApiError('LOGIN_UNAVAILABLE', '카카오 로그인이 설정되지 않음');
    let who: Awaited<ReturnType<KakaoAuth['verify']>>;
    try {
      who = await deps.kakao.verify(accessToken);
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
    return { user: { id: user.id }, token, expiresAt: nowKst(expiresAt) };
  };

  // 로그인: 앱이 카카오 SDK로 받은 액세스 토큰 → 우리 로그인 토큰
  r.post('/auth/kakao', async (c) => {
    const body = await parseBody(c, kakaoBody);
    return c.json(await loginWithKakao(body.accessToken));
  });

  // 브라우저 로그인 (11/2, 명세서 v2.6): 앱이 시작 주소를 브라우저로 열면 → 카카오 로그인 창 → 카카오가 콜백으로 인가 코드를 돌려줌 → 서버가 카카오 토큰으로 바꿔 확인하고 우리 로그인 토큰을 붙여 앱 주소로 돌려보냄.
  // REST API 키는 서버에만 있음. 콜백을 기다리는 로그인(state → 돌아갈 앱 주소)은 메모리에 두고 한 번 쓰면 지움 (서버 한 대, 다시 켜지면 다시 로그인)
  const returnSchemes = deps.returnSchemes ?? [];
  const pending = new Map<string, { returnTo: string; expiresAt: number }>();
  const returnOf = (raw: string | undefined): string | null => {
    if (!raw || raw.length > AUTH.returnToMax) return null;
    try {
      return returnSchemes.includes(new URL(raw).protocol.slice(0, -1).toLowerCase()) ? raw : null;
    } catch {
      return null;
    }
  };
  const backToApp = (c: Context, returnTo: string, params: Record<string, string>) => {
    const url = new URL(returnTo);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    c.header('Cache-Control', 'no-store'); // 로그인 토큰이 든 화면
    return c.html(loginPage(params.error ? '로그인하지 못했어요. 앱에서 다시 시도해 주세요.' : '로그인했어요.', url.toString()));
  };

  r.get('/auth/kakao/start', (c) => {
    const returnTo = returnOf(c.req.query('returnTo'));
    if (!returnTo) throw new ApiError('VALIDATION_ERROR', 'returnTo는 허용된 앱 주소여야 함');
    if (!deps.kakaoAppId || !deps.kakao?.authorizeUrl || !deps.kakao.exchange) return backToApp(c, returnTo, { error: 'LOGIN_UNAVAILABLE' });
    const now = Date.now();
    for (const [k, v] of pending) {
      if (v.expiresAt > now) break; // 넣은 순서 = 끝나는 순서
      pending.delete(k);
    }
    while (pending.size >= AUTH.maxPendingLogins) pending.delete(pending.keys().next().value as string);
    const state = randomBytes(24).toString('base64url');
    pending.set(state, { returnTo, expiresAt: now + AUTH.stateTtlMs });
    return c.redirect(deps.kakao.authorizeUrl(state), 302);
  });

  r.get('/auth/kakao/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    const wait = pending.get(state);
    pending.delete(state);
    if (!wait || wait.expiresAt <= Date.now()) {
      c.header('Cache-Control', 'no-store');
      return c.html(loginPage('로그인 시간이 지났거나 이미 처리됐어요. 앱에서 다시 로그인해 주세요.', null), 400);
    }
    const code = c.req.query('code');
    // 동의 화면에서 취소하면 카카오가 code 없이 error=access_denied로 돌려보냄
    if (!code) return backToApp(c, wait.returnTo, { error: c.req.query('error') === 'access_denied' ? 'LOGIN_CANCELLED' : 'UNAUTHORIZED' });
    let accessToken: string | null;
    try {
      accessToken = (await deps.kakao?.exchange?.(code)) ?? null;
    } catch (err) {
      console.warn('카카오 인가 코드 교환 실패:', err instanceof Error ? err.message.slice(0, 200) : err);
      return backToApp(c, wait.returnTo, { error: 'LOGIN_UNAVAILABLE' });
    }
    if (!accessToken) return backToApp(c, wait.returnTo, { error: 'UNAUTHORIZED' });
    try {
      const done = await loginWithKakao(accessToken);
      return backToApp(c, wait.returnTo, { token: done.token, userId: done.user.id, expiresAt: done.expiresAt });
    } catch (err) {
      if (err instanceof ApiError) return backToApp(c, wait.returnTo, { error: err.code });
      throw err;
    }
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
