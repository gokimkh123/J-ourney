import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { ApiError } from './errors.ts';

type Call = { url: string; init?: Parameters<FetchLike>[1] };

function fakeFetch(status: number, bodyText: string): { fetchFn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => bodyText };
  };
  return { fetchFn, calls };
}

test('URL 조합: baseUrl + /api/v1 + path, 쿼리 없으면 ? 없음', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host:8080', fetchFn });
  await client.get('/trips');
  assert.equal(calls[0].url, 'http://host:8080/api/v1/trips');
  assert.equal(calls[0].init?.method, 'GET');
  await client.get('/trips', { query: { a: undefined } });
  assert.equal(calls[1].url, 'http://host:8080/api/v1/trips');
});

test('쿼리 인코딩: 값은 encodeURIComponent, undefined는 생략', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  await client.get('/places', { query: { q: '부산 & 해운대', n: 2, skip: undefined, f: true } });
  assert.equal(
    calls[0].url,
    `http://host/api/v1/places?q=${encodeURIComponent('부산 & 해운대')}&n=2&f=true`,
  );
});

test('body: JSON 직렬화와 Content-Type 헤더', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  await client.post('/trips', { name: '여행' });
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[0].init?.body, JSON.stringify({ name: '여행' }));
  assert.equal(calls[0].init?.headers?.['Content-Type'], 'application/json');
  await client.put('/trips/1', { name: 'x' });
  assert.equal(calls[1].init?.method, 'PUT');
  assert.equal(calls[1].init?.body, JSON.stringify({ name: 'x' }));
});

test('body가 없으면 Content-Type과 body를 보내지 않음', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  await client.get('/trips');
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.headers?.['Content-Type'], undefined);
});

test('Authorization: 동기·비동기 토큰', async () => {
  const sync = fakeFetch(200, '{}');
  await createApiClient({
    baseUrl: 'http://host',
    fetchFn: sync.fetchFn,
    getToken: () => 'tok1',
  }).get('/me');
  assert.equal(sync.calls[0].init?.headers?.Authorization, 'Bearer tok1');

  const async_ = fakeFetch(200, '{}');
  await createApiClient({
    baseUrl: 'http://host',
    fetchFn: async_.fetchFn,
    getToken: async () => 'tok2',
  }).get('/me');
  assert.equal(async_.calls[0].init?.headers?.Authorization, 'Bearer tok2');
});

test('토큰이 없으면 Authorization을 붙이지 않음', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  await createApiClient({ baseUrl: 'http://host', fetchFn, getToken: () => null }).get('/me');
  await createApiClient({ baseUrl: 'http://host', fetchFn }).get('/me');
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
  assert.equal(calls[1].init?.headers?.Authorization, undefined);
});

test('auth=false 이면 토큰이 있어도 Authorization을 붙이지 않음', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, getToken: () => 'tok' });
  await client.get('/health', { auth: false });
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('2xx 본문은 JSON 파싱해 반환', async () => {
  const { fetchFn } = fakeFetch(200, '{"id":"trp_1","list":[1,2]}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  assert.deepEqual(await client.get('/trips/1'), { id: 'trp_1', list: [1, 2] });
});

test('본문이 비어 있으면 null', async () => {
  for (const status of [200, 204]) {
    const { fetchFn } = fakeFetch(status, '');
    const client = createApiClient({ baseUrl: 'http://host', fetchFn });
    assert.equal(await client.get('/x'), null);
  }
});

test('오류 응답은 parseApiError로 만든 ApiError를 던짐', async () => {
  const { fetchFn } = fakeFetch(
    404,
    JSON.stringify({ error: { code: 'NOT_FOUND', message: '없음' } }),
  );
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  await assert.rejects(client.get('/trips/9'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, '없음');
    return true;
  });
});

test('형식이 다른 5xx 오류는 INTERNAL_ERROR', async () => {
  const { fetchFn } = fakeFetch(502, 'Bad Gateway');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  await assert.rejects(client.get('/x'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    assert.equal(error.code, 'INTERNAL_ERROR');
    return true;
  });
});

test('fetch가 예외를 던지면 NETWORK_ERROR', async () => {
  const fetchFn: FetchLike = async () => {
    throw new TypeError('Network request failed');
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn });
  await assert.rejects(client.get('/x'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.status, 0);
    return true;
  });
});

test('timeoutMs 초과 시 abort하고 TIMEOUT', async () => {
  let signal: AbortSignal | undefined;
  const fetchFn: FetchLike = (_url, init) => {
    signal = init?.signal;
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, timeoutMs: 20 });
  await assert.rejects(client.get('/slow'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.status, 0);
    return true;
  });
  assert.equal(signal?.aborted, true);
});

test('signal을 무시하는 fetch도 timeoutMs 후 TIMEOUT', async () => {
  const fetchFn: FetchLike = () => new Promise(() => {});
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, timeoutMs: 20 });
  await assert.rejects(client.get('/hang'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'TIMEOUT');
    return true;
  });
});

test('정상 응답 시 signal은 abort되지 않음', async () => {
  const { fetchFn, calls } = fakeFetch(200, '{}');
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, timeoutMs: 20 });
  await client.get('/x');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls[0].init?.signal?.aborted, false);
});
