import test from 'node:test';
import assert from 'node:assert/strict';

import { clampSheetHeight, settleCollapsed } from './sheetSnap.ts';

test('높이는 접힌 높이와 펼친 높이 사이로 제한한다', () => {
  assert.equal(clampSheetHeight(10, 78, 300), 78);
  assert.equal(clampSheetHeight(500, 78, 300), 300);
  assert.equal(clampSheetHeight(200, 78, 300), 200);
});

test('천천히 놓으면 가까운 쪽에 붙는다', () => {
  assert.equal(settleCollapsed({ height: 120, min: 78, max: 300, vy: 0 }), true);
  assert.equal(settleCollapsed({ height: 250, min: 78, max: 300, vy: 0.1 }), false);
  assert.equal(settleCollapsed({ height: 188, min: 78, max: 300, vy: 0 }), true);
});

test('빠르게 쓸면 가까운 쪽과 상관없이 쓴 방향을 따른다', () => {
  assert.equal(settleCollapsed({ height: 280, min: 78, max: 300, vy: 0.8 }), true);
  assert.equal(settleCollapsed({ height: 100, min: 78, max: 300, vy: -0.8 }), false);
});
