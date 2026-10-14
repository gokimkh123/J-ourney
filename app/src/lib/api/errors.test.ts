import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, createNetworkError, createTimeoutError, parseApiError } from './errors.ts';

test('ApiError: Error 상속, status·code·name·message', () => {
  const error = new ApiError(404, 'NOT_FOUND', '없음');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof ApiError);
  assert.equal(error.name, 'ApiError');
  assert.equal(error.status, 404);
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.message, '없음');
});

test('parseApiError: 정상 오류 형식은 code·message를 그대로 사용', () => {
  const error = parseApiError(
    409,
    JSON.stringify({ error: { code: 'TRIP_FULL', message: '인원이 가득 찼습니다.' } }),
  );
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 409);
  assert.equal(error.code, 'TRIP_FULL');
  assert.equal(error.message, '인원이 가득 찼습니다.');
});

test('parseApiError: 잘못된 JSON은 UNKNOWN_ERROR와 한국어 기본 메시지', () => {
  for (const body of ['{not json', '', '<html>Bad</html>']) {
    const error = parseApiError(400, body);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'UNKNOWN_ERROR');
    assert.ok(/[가-힣]/.test(error.message));
  }
});

test('parseApiError: 형식 불일치는 UNKNOWN_ERROR', () => {
  const bodies = [
    'null',
    '42',
    '[]',
    '{}',
    '{"error":"x"}',
    '{"error":null}',
    '{"error":{"code":"A"}}',
    '{"error":{"message":"m"}}',
    '{"error":{"code":1,"message":"m"}}',
    '{"code":"A","message":"m"}',
  ];
  for (const body of bodies) {
    const error = parseApiError(404, body);
    assert.equal(error.code, 'UNKNOWN_ERROR', body);
    assert.equal(error.status, 404);
    assert.ok(/[가-힣]/.test(error.message));
  }
});

test('parseApiError: 5xx이고 형식이 다르면 INTERNAL_ERROR', () => {
  for (const status of [500, 502, 503]) {
    const error = parseApiError(status, 'Bad Gateway');
    assert.equal(error.status, status);
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.ok(/[가-힣]/.test(error.message));
  }
});

test('parseApiError: 5xx라도 정상 형식이면 서버가 준 code 사용', () => {
  const error = parseApiError(
    500,
    JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '서버 오류' } }),
  );
  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.equal(error.message, '서버 오류');
});

test('createNetworkError: NETWORK_ERROR, status 0', () => {
  const error = createNetworkError();
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'NETWORK_ERROR');
  assert.equal(error.status, 0);
  assert.ok(/[가-힣]/.test(error.message));
});

test('createTimeoutError: TIMEOUT, status 0', () => {
  const error = createTimeoutError();
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'TIMEOUT');
  assert.equal(error.status, 0);
  assert.ok(/[가-힣]/.test(error.message));
});
