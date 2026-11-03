import test from 'node:test';
import assert from 'node:assert/strict';

import { DOUBLE_TAP_MS, isDoubleTap } from './doubleTap.ts';

test('같은 칸을 0.3초 안에 다시 누르면 넘어가기', () => {
  assert.equal(DOUBLE_TAP_MS, 300);
  assert.equal(isDoubleTap({ key: 'q1:7', at: 1000 }, 'q1:7', 1300), true);
  assert.equal(isDoubleTap({ key: 'q1:7', at: 1000 }, 'q1:7', 1120), true);
});

test('처음 누름, 다른 칸, 0.3초가 지난 누름은 고르기만', () => {
  assert.equal(isDoubleTap(null, 'q1:7', 1000), false);
  assert.equal(isDoubleTap({ key: 'q1:7', at: 1000 }, 'q1:8', 1100), false);
  assert.equal(isDoubleTap({ key: 'q1:7', at: 1000 }, 'q2:7', 1100), false);
  assert.equal(isDoubleTap({ key: 'q1:7', at: 1000 }, 'q1:7', 1301), false);
});
