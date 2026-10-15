import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { ApiError } from './errors.ts';

function slowFetch(delayMs: number): FetchLike {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true, status: 200, text: async () => '{"ok":true}' }), delayMs);
    });
}

function isTimeout(error: unknown): boolean {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'TIMEOUT');
  return true;
}

test('요청별 timeoutMs가 기본값보다 길면 느린 응답도 성공', async () => {
  const client = createApiClient({ baseUrl: 'http://host', fetchFn: slowFetch(80), timeoutMs: 30 });
  assert.deepEqual(await client.get('/slow', { timeoutMs: 200 }), { ok: true });
});

test('요청별 timeoutMs가 더 짧으면 TIMEOUT', async () => {
  const client = createApiClient({ baseUrl: 'http://host', fetchFn: slowFetch(100), timeoutMs: 200 });
  await assert.rejects(client.get('/slow', { timeoutMs: 20 }), isTimeout);
});

test('지정하지 않으면 클라이언트 timeoutMs가 적용됨', async () => {
  const client = createApiClient({ baseUrl: 'http://host', fetchFn: slowFetch(100), timeoutMs: 30 });
  await assert.rejects(client.get('/slow'), isTimeout);
  await assert.rejects(client.post('/slow', { a: 1 }), isTimeout);
});

test('post 옵션의 timeoutMs로도 덮어씀', async () => {
  const client = createApiClient({ baseUrl: 'http://host', fetchFn: slowFetch(80), timeoutMs: 30 });
  assert.deepEqual(await client.post('/slow', { a: 1 }, { timeoutMs: 200 }), { ok: true });
  const short = createApiClient({ baseUrl: 'http://host', fetchFn: slowFetch(100), timeoutMs: 200 });
  await assert.rejects(short.post('/slow', { a: 1 }, { timeoutMs: 20 }), isTimeout);
});
