import test from 'node:test';
import assert from 'node:assert/strict';

import { WALK_MAX_MS, WALK_MIN_MS, walkMs } from './walk.ts';

test('가까우면 최소 시간, 멀면 최대 시간으로 제한된다', () => {
  assert.equal(walkMs(0), WALK_MIN_MS);
  assert.equal(walkMs(5), WALK_MIN_MS);
  assert.equal(walkMs(100000), WALK_MAX_MS);
});

test('중간 거리는 거리에 비례한다', () => {
  assert.equal(walkMs(90), 1000);
  assert.equal(walkMs(180), 2000);
});

test('speed가 클수록 빨리 걷는다', () => {
  assert.equal(walkMs(180, 2), 1000);
  assert.equal(walkMs(0, 3), WALK_MIN_MS / 3);
});

test('이상한 입력은 기본값으로 처리한다', () => {
  assert.equal(walkMs(Number.NaN), WALK_MIN_MS);
  assert.equal(walkMs(-5), WALK_MIN_MS);
  assert.equal(walkMs(180, 0), 2000);
  assert.equal(walkMs(180, Number.NaN), 2000);
});
