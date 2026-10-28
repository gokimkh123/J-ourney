import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';

function setup(getAccessKey?: () => string | undefined, getToken?: () => string | null) {
  const headers: Record<string, string>[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    headers.push({ ...(init?.headers as Record<string, string>) });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, getAccessKey, getToken });
  return { client, headers };
}

test('접근 키가 있으면 모든 요청에 X-Access-Key를 붙인다', async () => {
  const { client, headers } = setup(() => 'KEY');
  await client.get('/trips/t1');
  await client.post('/trips/t1/meetings');
  assert.equal(headers[0]['X-Access-Key'], 'KEY');
  assert.equal(headers[1]['X-Access-Key'], 'KEY');
});

test('접근 키가 없거나 빈 값이면 헤더를 아예 안 붙인다', async () => {
  const none = setup();
  await none.client.get('/x');
  assert.equal('X-Access-Key' in none.headers[0], false);
  const empty = setup(() => undefined);
  await empty.client.get('/x');
  assert.equal('X-Access-Key' in empty.headers[0], false);
});

test('접근 키와 토큰은 함께 간다', async () => {
  const { client, headers } = setup(() => 'KEY', () => 'TOKEN');
  await client.get('/x');
  assert.equal(headers[0]['X-Access-Key'], 'KEY');
  assert.match(headers[0].Authorization ?? '', /TOKEN/);
});
