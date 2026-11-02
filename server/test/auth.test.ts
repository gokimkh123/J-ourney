import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { members, userSessions } from '../src/db/schema.js';
import type { KakaoAuth } from '../src/lib/user.js';
import { call, createTestApp } from './helpers.js';

const APP_ID = '123456';
/** 가짜 카카오 토큰 확인기: 'kakao:{회원번호}:{앱 ID}' 모양의 토큰만 맞는 토큰으로 봄, 'down'이면 카카오에 묻지 못한 것처럼 */
const fakeKakao = (): KakaoAuth & { calls: number } => {
  const k = {
    calls: 0,
    async verify(accessToken: string) {
      k.calls++;
      if (accessToken === 'down') throw new Error('시험: 카카오 응답 없음');
      const m = /^kakao:(\d+):(\d+)$/.exec(accessToken);
      return m ? { kakaoId: m[1], appId: m[2] } : null;
    },
  };
  return k;
};
const tunnel = { 'cf-connecting-ip': '203.0.113.7' };

describe('카카오 로그인 (11/2, 명세서 v2.5)', () => {
  it('카카오 토큰을 확인해 계정(회원번호)과 로그인 토큰을 줌 · 같은 회원번호는 같은 계정 · 다른 앱의 토큰·잘못된 토큰은 401 · 카카오에 묻지 못하면 503 · 앱 ID가 없는 서버는 503', async () => {
    const kakao = fakeKakao();
    const { app, db } = await createTestApp({ kakaoAuth: kakao, kakaoAppId: APP_ID });
    const first = await call(app, 'POST', '/auth/kakao', { accessToken: `kakao:777:${APP_ID}` });
    expect(first.status).toBe(200);
    expect(first.body.token).toMatch(/^usr_/);
    expect(first.body.user.id).toMatch(/^usr_/);
    const again = await call(app, 'POST', '/auth/kakao', { accessToken: `kakao:777:${APP_ID}` });
    expect(again.body.user.id).toBe(first.body.user.id);
    expect(again.body.token).not.toBe(first.body.token); // 기기마다 토큰
    expect((await call(app, 'POST', '/auth/kakao', { accessToken: 'kakao:777:999' })).body.error.code).toBe('UNAUTHORIZED');
    expect((await call(app, 'POST', '/auth/kakao', { accessToken: 'garbage' })).body.error.code).toBe('UNAUTHORIZED');
    expect((await call(app, 'POST', '/auth/kakao', { accessToken: 'down' })).body.error.code).toBe('LOGIN_UNAVAILABLE');
    expect((await call(app, 'POST', '/auth/kakao', {})).body.error.code).toBe('VALIDATION_ERROR');
    // 토큰 원문은 저장하지 않음 (sha256만)
    const sessions = await db.select().from(userSessions);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => !s.tokenHash.startsWith('usr_'))).toBe(true);
    const off = await createTestApp({ kakaoAuth: kakao, kakaoAppId: null });
    expect((await call(off.app, 'POST', '/auth/kakao', { accessToken: `kakao:777:${APP_ID}` })).body.error.code).toBe('LOGIN_UNAVAILABLE');
  });

  it('로그인하고 만들거나 참여한 여행은 내 여행 목록에 남고, 구성원 토큰을 다시 받으면 예전 토큰은 더 쓰지 못함 · 같은 계정이 다시 참여하면 새 자리 대신 그 자리 · 로그아웃', async () => {
    const { app, db } = await createTestApp({ kakaoAuth: fakeKakao(), kakaoAppId: APP_ID });
    const login = async (id: string) => (await call(app, 'POST', '/auth/kakao', { accessToken: `kakao:${id}:${APP_ID}` })).body.token as string;
    const hostUser = await login('1');
    const guestUser = await login('2');
    const made = await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' }, hostUser);
    expect(made.status).toBe(201);
    const tripId = made.body.trip.id as string;
    const joined = await call(app, 'POST', `/invites/${made.body.trip.inviteCode}/join`, { nickname: '지은' }, guestUser);
    expect(joined.status).toBe(201);
    // 같은 계정이 다시 참여: 같은 자리(새 토큰), 인원은 그대로
    const rejoined = await call(app, 'POST', `/invites/${made.body.trip.inviteCode}/join`, { nickname: '지은2' }, guestUser);
    expect(rejoined.status).toBe(200);
    expect(rejoined.body.member.id).toBe(joined.body.member.id);
    expect((await db.select().from(members).where(eq(members.tripId, tripId))).length).toBe(2);
    expect((await call(app, 'GET', `/trips/${tripId}`, undefined, joined.body.token)).status).toBe(401);
    expect((await call(app, 'GET', `/trips/${tripId}`, undefined, rejoined.body.token)).status).toBe(200);
    // 내 여행 목록 → 토큰 다시 받기
    const mine = await call(app, 'GET', '/users/me/trips', undefined, hostUser);
    expect(mine.body.trips.map((x: { trip: { id: string }; member: { isHost: boolean } }) => [x.trip.id, x.member.isHost])).toEqual([[tripId, true]]);
    const fresh = await call(app, 'POST', `/users/me/trips/${tripId}/token`, undefined, hostUser);
    expect(fresh.status).toBe(200);
    expect((await call(app, 'GET', `/trips/${tripId}`, undefined, made.body.token)).status).toBe(401);
    expect((await call(app, 'GET', `/trips/${tripId}`, undefined, fresh.body.token)).status).toBe(200);
    // 남의 여행·로그인 없이·구성원 토큰으로는 못 받음
    expect((await call(app, 'POST', `/users/me/trips/trp_nope/token`, undefined, hostUser)).status).toBe(404);
    expect((await call(app, 'GET', '/users/me/trips')).status).toBe(401);
    expect((await call(app, 'GET', '/users/me/trips', undefined, fresh.body.token)).status).toBe(401);
    // 로그인 없이 만든 여행은 목록에 없음 (예전처럼 구성원 토큰만)
    await call(app, 'POST', '/trips', { title: '로그인 없이', nickname: '손님' });
    expect((await call(app, 'GET', '/users/me/trips', undefined, hostUser)).body.trips).toHaveLength(1);
    // 로그아웃하면 그 로그인 토큰은 쓰지 못함, 잘못된 로그인 토큰으로 만들기는 401
    expect((await call(app, 'DELETE', '/auth/session', undefined, hostUser)).status).toBe(204);
    expect((await call(app, 'GET', '/users/me/trips', undefined, hostUser)).status).toBe(401);
    expect((await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' }, hostUser)).body.error.code).toBe('UNAUTHORIZED');
  });

  it('로그인 필수(LOGIN_REQUIRED)면 바깥(터널) 요청은 로그인해야 만들기·참여 (401 LOGIN_REQUIRED), 서버 안 요청은 예전처럼 · 꺼져 있으면 누구나', async () => {
    const { app } = await createTestApp({ kakaoAuth: fakeKakao(), kakaoAppId: APP_ID, loginRequired: true });
    const blocked = await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' }, undefined, tunnel);
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('LOGIN_REQUIRED');
    // 구성원 토큰(tok_)을 보내도 로그인으로 보지 않음
    const local = await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' });
    expect(local.status).toBe(201);
    expect((await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' }, local.body.token, tunnel)).body.error.code).toBe('LOGIN_REQUIRED');
    expect((await call(app, 'POST', `/invites/${local.body.trip.inviteCode}/join`, { nickname: '지은' }, undefined, tunnel)).body.error.code).toBe('LOGIN_REQUIRED');
    const user = (await call(app, 'POST', '/auth/kakao', { accessToken: `kakao:5:${APP_ID}` }, undefined, tunnel)).body.token as string;
    expect((await call(app, 'POST', '/trips', { title: '부산', nickname: '민수' }, user, tunnel)).status).toBe(201);
    expect((await call(app, 'POST', `/invites/${local.body.trip.inviteCode}/join`, { nickname: '지은' }, user, tunnel)).status).toBe(201);
    const open = await createTestApp({ kakaoAuth: fakeKakao(), kakaoAppId: APP_ID, loginRequired: false });
    expect((await call(open.app, 'POST', '/trips', { title: '부산', nickname: '민수' }, undefined, tunnel)).status).toBe(201);
  });
});
