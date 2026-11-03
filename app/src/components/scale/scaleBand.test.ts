import test from 'node:test';
import assert from 'node:assert/strict';

import { BAND_R, CX, CY, R_IN, R_OUT, bandPath, pickedCircle, slotDeg } from './scaleDial.ts';

test('고른 칸 동그라미는 칸 가운데 각도에, 부푼 띠 두께에 딱 맞게(바깥으로 살짝)', () => {
  const n = 11;
  const c = pickedCircle(7, n);
  const dist = Math.hypot(c.x - CX, c.y - CY);
  assert.equal(c.r, 14);
  assert.ok(Math.abs(dist - (BAND_R + 3)) < 0.05);
  const deg = (Math.atan2(c.y - CY, c.x - CX) * 180) / Math.PI;
  assert.ok(Math.abs(((deg - slotDeg(7, n) + 540) % 360) - 180) < 0.1);
});

test('부푼 띠는 칸 누르는 자리(R_IN~R_OUT) 안에 들어간다', () => {
  const d = bandPath(slotDeg(0, 11), slotDeg(10, 11), 11);
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // A 명령의 반지름·플래그를 뺀 좌표 쌍만 본다: M/L 뒤 좌표만 모은다.
  const pts = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.hypot(Number(m[1]) - CX, Number(m[2]) - CY));
  assert.ok(nums.length > 0 && pts.length > 20);
  for (const r of pts) assert.ok(r > R_IN && r < R_OUT, `반지름 ${r}`);
});
