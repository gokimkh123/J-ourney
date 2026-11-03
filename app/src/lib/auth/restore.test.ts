import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient } from '../api/client.ts';
import { createEndpoints } from '../api/endpoints.ts';
import { ApiError } from '../api/errors.ts';
import { createMockFetch } from '../api/mock.ts';
import { createMockRoutes } from '../api/mockRoutes.ts';
import type { SessionResponse } from '../persona/types.ts';
import type { Session } from '../session/session.ts';
import { restoreMyTrips } from './restore.ts';

const response = (tripId: string): SessionResponse => ({
  trip: { id: tripId, title: tripId, inviteCode: 'ABC123', status: 'preparing' },
  member: { id: `mem_${tripId}`, nickname: '민수', color: '#F97316', isHost: false, personaReady: false, title: null },
  token: `tok_${tripId}`,
});

test('이 폰에 없는 여행만 토큰을 다시 받아 넣고, 실패한 여행은 센다', async () => {
  const added: Session[] = [];
  const asked: string[] = [];
  const result = await restoreMyTrips({
    getMyTripIds: async () => ['trp_1', 'trp_2', 'trp_3'],
    reissueTripToken: async (id) => {
      asked.push(id);
      if (id === 'trp_3') throw new Error('없음');
      return response(id);
    },
    localTripIds: () => ['trp_1'],
    add: async (s) => void added.push(s),
  });
  assert.deepEqual(asked, ['trp_2', 'trp_3']);
  assert.deepEqual(added.map((s) => s.tripId), ['trp_2']);
  assert.equal(added[0]!.token, 'tok_trp_2');
  assert.deepEqual(result, { restored: 1, failed: 1 });
});

/** 가짜 서버 하나를 두 폰이 쓰는 모양: 폰마다 구성원 토큰·로그인 토큰을 따로 든다. */
function phone(fetchFn: ReturnType<typeof createMockFetch>) {
  const state = { token: null as string | null, login: null as string | null };
  const client = createApiClient({ baseUrl: 'http://mock.local', fetchFn, getToken: () => state.token, getLoginToken: () => state.login });
  return { state, api: createEndpoints(client) };
}

test('가짜 서버: 로그인한 채 만든 여행을 다른 폰에서 같은 카카오 계정으로 되찾는다', async () => {
  const fetchFn = createMockFetch(createMockRoutes());
  const a = phone(fetchFn);
  a.state.login = (await a.api.loginKakao('kakao-민수')).token;
  assert.match(a.state.login, /^usr_/);
  const made = await a.api.createTrip('부산 1박 2일', '민수', false);
  a.state.token = made.token;
  // 로그인하지 않고 만든 여행은 계정에 묶이지 않는다.
  a.state.login = null;
  await a.api.createTrip('묶이지 않는 여행', '민수', false);

  const b = phone(fetchFn);
  b.state.login = (await b.api.loginKakao('kakao-민수')).token;
  assert.deepEqual(await b.api.getMyTripIds(), [made.trip.id]);
  const again = await b.api.reissueTripToken(made.trip.id);
  assert.equal(again.member.id, made.member.id);
  assert.notEqual(again.token, made.token);

  // 새 토큰을 받으면 예전 폰의 토큰은 더 쓰지 못한다.
  await assert.rejects(a.api.getTrip(made.trip.id), (e: unknown) => e instanceof ApiError && e.status === 401);
  b.state.token = again.token;
  assert.equal((await b.api.getTrip(made.trip.id)).trip.id, made.trip.id);
});

test('가짜 서버: 같은 계정이 다시 참여하면 새 자리 대신 그 자리를 돌려주고, 로그아웃하면 로그인 토큰을 못 쓴다', async () => {
  const fetchFn = createMockFetch(createMockRoutes());
  const host = phone(fetchFn);
  const made = await host.api.createTrip('강릉', '현우', false);

  const me = phone(fetchFn);
  me.state.login = (await me.api.loginKakao('kakao-지은')).token;
  const first = await me.api.joinInvite(made.trip.inviteCode, '지은');
  const second = await me.api.joinInvite(made.trip.inviteCode, '지은2');
  assert.equal(second.member.id, first.member.id);

  await me.api.logout();
  await assert.rejects(me.api.getMyTripIds(), (e: unknown) => e instanceof ApiError && e.status === 401);
});
