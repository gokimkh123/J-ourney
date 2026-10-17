import test from 'node:test';
import assert from 'node:assert/strict';

import { durationLabel } from './format.ts';

test('durationLabel: 60초 미만은 초, 소수는 내림', () => {
  assert.equal(durationLabel(0), '0초');
  assert.equal(durationLabel(41.9), '41초');
  assert.equal(durationLabel(59), '59초');
});

test('durationLabel: 분 단위와 분+초', () => {
  assert.equal(durationLabel(60), '1분');
  assert.equal(durationLabel(180), '3분');
  assert.equal(durationLabel(192), '3분 12초');
});

test('durationLabel: 음수·NaN·Infinity는 0초', () => {
  assert.equal(durationLabel(-5), '0초');
  assert.equal(durationLabel(Number.NaN), '0초');
  assert.equal(durationLabel(Number.POSITIVE_INFINITY), '0초');
  assert.equal(durationLabel(Number.NEGATIVE_INFINITY), '0초');
});
