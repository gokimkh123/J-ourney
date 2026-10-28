import test from 'node:test';
import assert from 'node:assert/strict';

import { settleLevel } from './sheetLevels.ts';

const levels = [78, 250, 480];

test('천천히 놓으면 가장 가까운 단계에 붙는다', () => {
  assert.equal(settleLevel({ height: 100, levels, vy: 0 }), 0);
  assert.equal(settleLevel({ height: 200, levels, vy: 0.1 }), 1);
  assert.equal(settleLevel({ height: 400, levels, vy: -0.1 }), 2);
});

test('빠르게 아래로 쓸면 한 단계 아래로 간다', () => {
  assert.equal(settleLevel({ height: 480, levels, vy: 1 }), 1);
  assert.equal(settleLevel({ height: 250, levels, vy: 1 }), 0);
  assert.equal(settleLevel({ height: 300, levels, vy: 1 }), 1);
});

test('빠르게 위로 쓸면 한 단계 위로 간다', () => {
  assert.equal(settleLevel({ height: 78, levels, vy: -1 }), 1);
  assert.equal(settleLevel({ height: 250, levels, vy: -1 }), 2);
  assert.equal(settleLevel({ height: 300, levels, vy: -1 }), 2);
});

test('맨 위·맨 아래에서는 더 못 간다', () => {
  assert.equal(settleLevel({ height: 480, levels, vy: -1 }), 2);
  assert.equal(settleLevel({ height: 78, levels, vy: 1 }), 0);
});

test('단계가 하나뿐이면 0', () => {
  assert.equal(settleLevel({ height: 100, levels: [100], vy: 1 }), 0);
});
