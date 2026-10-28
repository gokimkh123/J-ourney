import test from 'node:test';
import assert from 'node:assert/strict';

import { spreadPoints } from './spreadPoints.ts';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('충분히 떨어진 점은 그대로 둔다', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.deepEqual(spreadPoints(pts, 40), pts);
});

test('가까운 점은 최소 간격만큼 벌린다', () => {
  const out = spreadPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], 40);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) assert.ok(dist(out[i]!, out[j]!) >= 40 - 0.5);
  }
});

test('같은 자리에 겹친 점도 벌리고, 입력은 바꾸지 않는다', () => {
  const pts = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
  const out = spreadPoints(pts, 30);
  assert.ok(dist(out[0]!, out[1]!) >= 30 - 0.5);
  assert.deepEqual(pts, [{ x: 5, y: 5 }, { x: 5, y: 5 }]);
});
