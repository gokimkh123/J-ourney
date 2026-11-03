import test from 'node:test';
import assert from 'node:assert/strict';

import { pathMidArrows } from './regionArt.ts';

test('경로 꺾쇠는 구간마다 하나, 곧은 길이면 가운데에서 가는 쪽을 본다', () => {
  const arrows = pathMidArrows([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  assert.equal(arrows.length, 1);
  assert.deepEqual(arrows[0], { x: 50, y: 0, deg: 0, length: 100 });
});

test('아래로 가는 구간은 90°, 왼쪽으로 돌아오는 구간은 180° 쪽', () => {
  const [down, back] = pathMidArrows([
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: -100, y: 100 },
  ]);
  assert.ok(Math.abs(down!.deg - 90) < 30);
  assert.ok(Math.abs(Math.abs(back!.deg) - 180) < 30);
});

test('점이 2개 미만이면 꺾쇠 없음', () => {
  assert.deepEqual(pathMidArrows([{ x: 1, y: 1 }]), []);
});

test('가운데가 가려지면 옆자리로 옮기고, 다 가려지면 그 구간은 뺀다', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const [moved] = pathMidArrows(line, (p) => Math.abs(p.x - 50) > 5);
  assert.ok(moved !== undefined && Math.abs(moved.x - 50) > 5);
  assert.deepEqual(pathMidArrows(line, () => false), []);
});
