import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import { ApiError } from './errors.ts';
import { createMockFetch } from './mock.ts';
import { createMockRoutes } from './mockRoutes.ts';

type Call = { url: string; method: string; body: unknown };

function setup(status: number, text = '') {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, getToken: () => 'tok' });
  return { endpoints: createEndpoints(client), calls };
}

test('editPlan: baseVersion을 주면 본문에 같이 싣는다(v2.4)', async () => {
  const { endpoints, calls } = setup(200, '{}');
  await endpoints.editPlan('trp_1', [{ type: 'remove', itemId: 'itm_A1_plc_1' }], 3);
  assert.deepEqual(calls[0], {
    url: 'http://host/api/v1/trips/trp_1/plan/edits',
    method: 'POST',
    body: { edits: [{ type: 'remove', itemId: 'itm_A1_plc_1' }], baseVersion: 3 },
  });
});

test('editPlan: reorder는 placeIds로도 보낼 수 있다(v2.4)', async () => {
  const { endpoints, calls } = setup(200, '{}');
  await endpoints.editPlan('trp_1', [{ type: 'reorder', day: 0, placeIds: ['plc_2', 'plc_1'] }], 0);
  assert.deepEqual(calls[0]?.body, { edits: [{ type: 'reorder', day: 0, placeIds: ['plc_2', 'plc_1'] }], baseVersion: 0 });
});

test('leaveTrip·deleteTrip: DELETE 주소, 204 빈 응답', async () => {
  const { endpoints, calls } = setup(204);
  await endpoints.leaveTrip('trp 1');
  await endpoints.deleteTrip('trp_1');
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ['DELETE', 'http://host/api/v1/trips/trp%201/members/me', undefined],
      ['DELETE', 'http://host/api/v1/trips/trp_1', undefined],
    ],
  );
});

test('leaveTrip: 방장 403·회의 시작 뒤 409는 ApiError로 던진다', async () => {
  const { endpoints } = setup(409, JSON.stringify({ error: { code: 'CONFLICT', message: '회의가 시작됐어요' } }));
  await assert.rejects(endpoints.leaveTrip('trp_1'), (e: unknown) => e instanceof ApiError && e.status === 409);
});

// 가짜 서버도 v2.4 나가기·없애기를 따른다
function mockApp() {
  let token: string | null = null;
  const client = createApiClient({ baseUrl: 'http://mock.local', fetchFn: createMockFetch(createMockRoutes()), getToken: () => token });
  return { endpoints: createEndpoints(client), use: (t: string) => (token = t) };
}

test('가짜 서버: 파티원 나가기 204 → 구성원에서 빠지고 그 토큰은 더 못 쓴다, 방장은 403', async () => {
  const app = mockApp();
  const host = await app.endpoints.createTrip('부산 여행', '민수', false);
  const guest = await app.endpoints.joinInvite(host.trip.inviteCode, '지은');
  app.use(guest.token);
  await app.endpoints.leaveTrip(host.trip.id);
  const info = await app.endpoints.getInvite(host.trip.inviteCode);
  assert.deepEqual(info.members.map((m) => m.nickname), ['민수']);
  await assert.rejects(app.endpoints.getTrip(host.trip.id), (e: unknown) => e instanceof ApiError && e.status === 401);
  app.use(host.token);
  await assert.rejects(app.endpoints.leaveTrip(host.trip.id), (e: unknown) => e instanceof ApiError && e.status === 403);
});

test('가짜 서버: 방장만 파티를 없앤다, 없앤 뒤 초대 조회는 404', async () => {
  const app = mockApp();
  const host = await app.endpoints.createTrip('부산 여행', '민수', false);
  const guest = await app.endpoints.joinInvite(host.trip.inviteCode, '지은');
  app.use(guest.token);
  await assert.rejects(app.endpoints.deleteTrip(host.trip.id), (e: unknown) => e instanceof ApiError && e.status === 403);
  app.use(host.token);
  await app.endpoints.deleteTrip(host.trip.id);
  await assert.rejects(app.endpoints.getInvite(host.trip.inviteCode), (e: unknown) => e instanceof ApiError && e.status === 404);
});
