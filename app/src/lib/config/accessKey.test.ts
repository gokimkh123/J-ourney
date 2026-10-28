import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAccessKey } from './config.ts';

test('접근 키: 앞뒤 공백은 지우고 그대로 쓴다', () => {
  assert.equal(resolveAccessKey({ EXPO_PUBLIC_ACCESS_KEY: '  abc123  ' }), 'abc123');
});

test('접근 키: 없거나 비어 있으면 빈 문자열', () => {
  assert.equal(resolveAccessKey({}), '');
  assert.equal(resolveAccessKey({ EXPO_PUBLIC_ACCESS_KEY: '   ' }), '');
});

test('접근 키: 200자를 넘거나 줄바꿈이 섞이면 버린다', () => {
  assert.equal(resolveAccessKey({ EXPO_PUBLIC_ACCESS_KEY: 'a'.repeat(200) }), 'a'.repeat(200));
  assert.equal(resolveAccessKey({ EXPO_PUBLIC_ACCESS_KEY: 'a'.repeat(201) }), '');
  assert.equal(resolveAccessKey({ EXPO_PUBLIC_ACCESS_KEY: 'ab\ncd' }), '');
  assert.equal(resolveAccessKey({ EXPO_PUBLIC_ACCESS_KEY: 'ab\r\ncd' }), '');
});
