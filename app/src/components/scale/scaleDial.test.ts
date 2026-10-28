import assert from "node:assert/strict";
import { test } from "node:test";

import { CX, CY, DIAL_H, DIAL_W, labelPoint, sectorPath, tickOpacity, tickPath } from "./scaleDial.ts";

const N = 11;

test("숫자 자리: 0은 왼쪽 아래, 가운데(5)는 위쪽 한가운데, 마지막은 오른쪽 아래", () => {
  const first = labelPoint(0, N);
  const mid = labelPoint(5, N);
  const last = labelPoint(N - 1, N);
  assert.ok(first.x < CX && first.y > CY, "0은 중심의 왼쪽 아래");
  assert.ok(last.x > CX && last.y > CY, "10은 중심의 오른쪽 아래");
  assert.ok(Math.abs(mid.x - CX) < 0.01 && mid.y < CY, "5는 위쪽 한가운데");
  assert.ok(Math.abs(first.y - last.y) < 0.01 && Math.abs(CX - first.x - (last.x - CX)) < 0.01, "양 끝은 좌우 대칭");
});

test("숫자 자리는 왼쪽에서 위를 지나 오른쪽으로 이어지고 모두 그림 안이다", () => {
  const pts = Array.from({ length: N }, (_, i) => labelPoint(i, N));
  for (const p of pts) assert.ok(p.x > 0 && p.x < DIAL_W && p.y > 0 && p.y < DIAL_H, JSON.stringify(p));
  // 위쪽(y가 가장 작은 칸)은 가운데 칸이고, 거기까지 y는 줄고 그 뒤로는 는다
  for (let i = 1; i <= 5; i++) assert.ok(pts[i]!.y <= pts[i - 1]!.y + 1e-9, `올라감 ${i}`);
  for (let i = 6; i < N; i++) assert.ok(pts[i]!.y >= pts[i - 1]!.y - 1e-9, `내려감 ${i}`);
});

test("칸 path는 칸 수만큼 서로 다르고 숫자로 이뤄진다", () => {
  const paths = Array.from({ length: N }, (_, i) => sectorPath(i, N));
  assert.equal(new Set(paths).size, N);
  for (const d of paths) {
    assert.ok(d.startsWith("M") && d.endsWith("Z"));
    assert.ok(!/NaN|Infinity/.test(d), d);
  }
});

test("칸 수가 달라도(5칸·2칸·1칸) 깨지지 않는다", () => {
  for (const n of [1, 2, 5, 7]) {
    for (let i = 0; i < n; i++) {
      assert.ok(!/NaN|Infinity/.test(sectorPath(i, n) + tickPath(i, n)));
      const p = labelPoint(i, n);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
  }
});

test("안쪽 호는 오른쪽으로 갈수록 진해진다", () => {
  const o = Array.from({ length: N }, (_, i) => tickOpacity(i, N));
  for (let i = 1; i < N; i++) assert.ok(o[i]! > o[i - 1]!);
  assert.ok(o[0]! >= 0.2 && o[N - 1]! <= 0.9);
  assert.equal(tickOpacity(0, 1), 0.9);
});
