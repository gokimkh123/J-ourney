import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import { createMockFetch } from './mock.ts';
import type { MockRoute } from './mock.ts';

const echoRoute: MockRoute = {
  method: 'GET',
  path: '/api/v1/echo-headers',
  handler: ({ headers }) => ({ status: 200, body: { headers } }),
};

test('헤더 키는 소문자로 핸들러에 전달됨', async () => {
  const fetchFn = createMockFetch([echoRoute]);
  const response = await fetchFn('http://mock.local/api/v1/echo-headers', {
    method: 'GET',
    headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json', 'x-Custom': 'v' },
  });
  assert.deepEqual(JSON.parse(await response.text()), {
    headers: {
      authorization: 'Bearer abc',
      'content-type': 'application/json',
      'x-custom': 'v',
    },
  });
});

test('init.headers가 없으면 headers는 빈 객체', async () => {
  const fetchFn = createMockFetch([echoRoute]);
  const noInit = await fetchFn('http://mock.local/api/v1/echo-headers');
  assert.deepEqual(JSON.parse(await noInit.text()), { headers: {} });
  const noHeaders = await fetchFn('http://mock.local/api/v1/echo-headers', { method: 'GET' });
  assert.deepEqual(JSON.parse(await noHeaders.text()), { headers: {} });
});

test('ApiClient 토큰이 Authorization 헤더로 핸들러에 전달됨', async () => {
  const client = createApiClient({
    baseUrl: 'http://mock.local',
    fetchFn: createMockFetch([echoRoute]),
    getToken: () => 'tok',
  });
  assert.deepEqual(await client.get('/echo-headers'), {
    headers: { authorization: 'Bearer tok' },
  });
  assert.deepEqual(await client.get('/echo-headers', { auth: false }), { headers: {} });
});
