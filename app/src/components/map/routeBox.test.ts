import assert from 'node:assert/strict';
import test from 'node:test';

import { smoothPath } from './regionArt.ts';
import { routeBox } from './routeBox.ts';

test('점이 없으면 판도 없다', () => {
  assert.equal(routeBox([], 2), null);
});

test('점을 모두 덮고, 선 굵기만큼(화면 24px) 둘레를 둔다', () => {
  // 점 하나: 길이 0이라 곡선 몫은 없고 24/2 = 12
  assert.deepEqual(routeBox([{ x: 100, y: 200 }], 2), { x: 88, y: 188, w: 24, h: 24 });
});

test('곡선이 부푸는 몫(큰 쪽 길이의 1/6)까지 둘레에 넣는다', () => {
  const box = routeBox(
    [
      { x: 0, y: 0 },
      { x: 60, y: 30 },
    ],
    1,
  );
  // 24 + 60/6 = 34
  assert.deepEqual(box, { x: -34, y: -34, w: 128, h: 98 });
});

test('곡선(smoothPath)의 조절점까지 모두 판 안이라 선이 잘리지 않는다', () => {
  // 베지어 곡선은 조절점들이 만드는 볼록 껍질 안에 있으므로, 조절점이 모두 판 안이면 곡선도 판 안이다.
  const points = [
    { x: 10, y: 10 },
    { x: 200, y: 40 },
    { x: 30, y: 180 },
    { x: 220, y: 220 },
    { x: 15, y: 230 },
  ];
  const box = routeBox(points, 1)!;
  const numbers = (smoothPath(points).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  assert.ok(numbers.length > 0);
  for (let i = 0; i < numbers.length; i += 2) {
    const x = numbers[i]!;
    const y = numbers[i + 1]!;
    assert.ok(x >= box.x && x <= box.x + box.w, `x ${x}`);
    assert.ok(y >= box.y && y <= box.y + box.h, `y ${y}`);
  }
});

test('그림 전체가 아니라 경로 둘레만큼이라 판이 훨씬 작다', () => {
  const box = routeBox(
    [
      { x: 500, y: 500 },
      { x: 560, y: 540 },
      { x: 600, y: 520 },
    ],
    3,
  )!;
  assert.ok(box.w * box.h < (1019 * 976) / 50);
});
