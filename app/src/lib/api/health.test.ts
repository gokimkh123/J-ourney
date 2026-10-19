import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { ApiError } from './errors.ts';
import { checkHealth } from './health.ts';

type Call = { url: string; init?: Parameters<FetchLike>[1] };

function fakeFetch(status: number, bodyText: string): { fetchFn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => bodyText };
  };
  return { fetchFn, calls };
}

function fakeNow(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('checkHealth: 성공 시 ok=true와 now() 전후 차이를 latencyMs로 반환', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{"status":"ok"}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  const result = await checkHealth(client, fakeNow(1000, 1042));
  assert.deepEqual(result, { ok: true, latencyMs: 42 });
  assert.equal(calls[0].url, 'http://host/api/v1/health');
  assert.equal(calls[0].init?.method, 'GET');
});

test('checkHealth: 본문이 비어 있어도 2xx면 성공', async () => {
  const { fetchFn } = fakeFetch(204, '');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  const result = await checkHealth(client, fakeNow(5, 8));
  assert.deepEqual(result, { ok: true, latencyMs: 3 });
});

test('checkHealth: 본문이 JSON이 아니어도 2xx면 성공', async () => {
  for (const body of ['OK', '<html>ok</html>']) {
    const { fetchFn } = fakeFetch(200, body);
    const client = createApiClient({ baseUrl: 'http://host', fetchFn });
    const result = await checkHealth(client, fakeNow(10, 25));
    assert.deepEqual(result, { ok: true, latencyMs: 15 }, body);
  }
});

test('checkHealth: 토큰이 있어도 Authorization을 보내지 않음', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, getToken: () => 'secret' });
  await checkHealth(client, fakeNow(0, 1));
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('checkHealth: 오류 응답은 던지지 않고 ok=false와 ApiError', async () => {
  const { fetchFn } = fakeFetch(
    500,
    JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '서버 오류' } }),
  );
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  const result = await checkHealth(client, fakeNow(0, 1));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof ApiError);
    assert.equal(result.error.code, 'INTERNAL_ERROR');
    assert.equal(result.error.message, '서버 오류');
  }
});

test('checkHealth: 네트워크 오류는 NETWORK_ERROR로 반환', async () => {
  const fetchFn: FetchLike = async () => {
    throw new TypeError('Network request failed');
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  const result = await checkHealth(client);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'NETWORK_ERROR');
});

test('checkHealth: ApiError가 아닌 예외도 ApiError로 감싸 반환', async () => {
  for (const thrown of [new Error('boom'), 'text', null]) {
    const client = {
      get: async () => {
        throw thrown;
      },
    };
    const result = await checkHealth(client, fakeNow(0, 1));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error instanceof ApiError);
      assert.equal(typeof result.error.code, 'string');
      assert.ok(/[가-힣]/.test(result.error.message));
    }
  }
});
