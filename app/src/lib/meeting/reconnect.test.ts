import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWsUrl, nextDelayMs } from './reconnect.ts';

test('nextDelayMs: 지연 시퀀스', () => {
  const delays = [0, 1, 2, 3, 4, 5, 6].map((attempt) => nextDelayMs(attempt));
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test('nextDelayMs: 매우 큰 attempt는 상한 30000', () => {
  assert.equal(nextDelayMs(100), 30000);
  assert.equal(nextDelayMs(5000), 30000);
  assert.equal(nextDelayMs(Number.MAX_SAFE_INTEGER), 30000);
});

test('nextDelayMs: 음수·비정수는 0으로 취급', () => {
  assert.equal(nextDelayMs(-1), 1000);
  assert.equal(nextDelayMs(1.5), 1000);
  assert.equal(nextDelayMs(Number.NaN), 1000);
});

test('buildWsUrl: https는 wss', () => {
  assert.equal(
    buildWsUrl({ baseUrl: 'https://abc.example.com', tripId: 'trp_8f3k2', token: 'tok', afterSeq: 5 }),
    'wss://abc.example.com/api/v1/trips/trp_8f3k2/ws?token=tok&afterSeq=5',
  );
});

test('buildWsUrl: http는 ws, 포트 유지', () => {
  assert.equal(
    buildWsUrl({ baseUrl: 'http://localhost:8080', tripId: 'trp_8f3k2', token: 'tok' }),
    'ws://localhost:8080/api/v1/trips/trp_8f3k2/ws?token=tok&afterSeq=0',
  );
});

test('buildWsUrl: 끝의 /를 모두 제거', () => {
  assert.equal(
    buildWsUrl({ baseUrl: 'https://abc.example.com///', tripId: 't1', token: 'x' }),
    'wss://abc.example.com/api/v1/trips/t1/ws?token=x&afterSeq=0',
  );
});

test('buildWsUrl: 토큰 특수문자 인코딩', () => {
  const url = buildWsUrl({ baseUrl: 'https://abc.example.com', tripId: 't1', token: 'a b+c/d&e' });
  assert.ok(url.includes(`token=${encodeURIComponent('a b+c/d&e')}&`));
  assert.ok(url.includes('token=a%20b%2Bc%2Fd%26e&afterSeq=0'));
});

test('buildWsUrl: afterSeq 기본값 0', () => {
  assert.ok(buildWsUrl({ baseUrl: 'https://a.com', tripId: 't1', token: 'x' }).endsWith('&afterSeq=0'));
});

test('buildWsUrl: afterSeq 지정값', () => {
  assert.ok(
    buildWsUrl({ baseUrl: 'https://a.com', tripId: 't1', token: 'x', afterSeq: 42 }).endsWith('&afterSeq=42'),
  );
});
