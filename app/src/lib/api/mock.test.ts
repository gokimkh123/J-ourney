import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import { createMockFetch } from './mock.ts';

test('createMockFetch: GET /api/v1/health 는 200과 { status, mock }', async () => {
  const fetchFn = createMockFetch();
  const response = await fetchFn('http://mock.local/api/v1/health', { method: 'GET' });
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"status":"ok","mock":true}');
});

test('createMockFetch: method 생략 시 GET, 쿼리는 무시하고 매칭', async () => {
  const fetchFn = createMockFetch();
  const response = await fetchFn('http://mock.local/api/v1/health?x=1');
  assert.equal(response.status, 200);
});

test('createMockFetch: 알 수 없는 경로는 404 NOT_FOUND 오류 형식', async () => {
  const fetchFn = createMockFetch();
  const response = await fetchFn('http://mock.local/api/v1/nope', { method: 'GET' });
  assert.equal(response.ok, false);
  assert.equal(response.status, 404);
  const body = JSON.parse(await response.text());
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(typeof body.error.message, 'string');
  assert.ok(body.error.message.length > 0);
});

test('createMockFetch: 메서드가 다르면 404', async () => {
  const fetchFn = createMockFetch();
  const response = await fetchFn('http://mock.local/api/v1/health', { method: 'POST' });
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(await response.text()).error.code, 'NOT_FOUND');
});

test('createMockFetch: 라우트를 인자로 추가하고 params·body를 받음', async () => {
  const fetchFn = createMockFetch([
    {
      method: 'POST',
      path: '/api/v1/trips/:tripId/echo',
      handler: ({ params, body }) => ({ status: 201, body: { tripId: params.tripId, body } }),
    },
  ]);
  const response = await fetchFn('http://mock.local/api/v1/trips/trp_1/echo', {
    method: 'POST',
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(response.ok, true);
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(await response.text()), { tripId: 'trp_1', body: { a: 1 } });

  const health = await fetchFn('http://mock.local/api/v1/health');
  assert.equal(health.status, 200);
});

test('createMockFetch: ApiClient와 함께 동작', async () => {
  const client = createApiClient({ baseUrl: 'http://mock.local', fetchFn: createMockFetch() });
  assert.deepEqual(await client.get('/health', { auth: false }), { status: 'ok', mock: true });
  await assert.rejects(client.get('/missing'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'NOT_FOUND');
    return true;
  });
});
