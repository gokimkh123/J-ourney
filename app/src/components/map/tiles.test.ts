import test from 'node:test';
import assert from 'node:assert/strict';

import { projectGeo, unprojectGeo } from './regionArt.ts';
import {
  MAX_TILE_Z,
  MIN_TILE_Z,
  cameraOn,
  clampCamera,
  destinationRect,
  latToTileY,
  lngToTileX,
  scaleLimits,
  tileXToLng,
  tileYToLat,
  tilesFor,
  viewRect,
  zoomAround,
  zoomForScale,
} from './tiles.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('위도·경도 ↔ 타일 번호(오갔다 와도 같음), 부산역은 z12에서 (3516, 1620) 칸', () => {
  for (const [lat, lng] of [[35.115, 129.04], [34.9, 128.8], [35.4, 129.3]]) {
    near(tileYToLat(latToTileY(lat!, 12), 12), lat!);
    near(tileXToLng(lngToTileX(lng!, 12), 12), lng!);
  }
  assert.deepEqual([Math.floor(lngToTileX(129.04, 12)), Math.floor(latToTileY(35.115, 12))], [3516, 1620]);
});

test('그림 좌표 ↔ 위도·경도(projectGeo의 반대)', () => {
  const g = { lat: 35.1532, lng: 129.1186 };
  const back = unprojectGeo(projectGeo(g));
  near(back.lat, g.lat);
  near(back.lng, g.lng);
});

test('타일 사각형은 빈틈 없이 이어지고, 범위를 덮는다', () => {
  const rect = { x0: 300, y0: 300, x1: 500, y1: 520 };
  const tiles = tilesFor(rect, 12, 0);
  assert.ok(tiles.length > 0);
  const xs = Math.min(...tiles.map((t) => t.left));
  const ys = Math.min(...tiles.map((t) => t.top));
  const xe = Math.max(...tiles.map((t) => t.left + t.width));
  const ye = Math.max(...tiles.map((t) => t.top + t.height));
  assert.ok(xs <= rect.x0 && ys <= rect.y0 && xe >= rect.x1 && ye >= rect.y1, '범위를 덮음');
  // 옆 타일의 왼쪽 = 이 타일의 오른쪽
  const a = tiles.find((t) => t.x === tiles[0]!.x && t.y === tiles[0]!.y)!;
  const right = tiles.find((t) => t.x === a.x + 1 && t.y === a.y);
  if (right) near(right.left, a.left + a.width, 1e-9);
  const below = tiles.find((t) => t.x === a.x && t.y === a.y + 1);
  if (below) near(below.top, a.top + a.height, 1e-9);
  assert.equal(new Set(tiles.map((t) => t.key)).size, tiles.length);
});

test('확대 단계: 배율이 클수록 높고 한도 안', () => {
  const zs = [0.3, 1, 4, 16, 64].map((s) => zoomForScale(s, 2));
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i]! >= zs[i - 1]!);
  assert.ok(zs.every((z) => z >= MIN_TILE_Z && z <= MAX_TILE_Z));
  assert.ok(zoomForScale(1, 3) >= zoomForScale(1, 1), '촘촘한 화면은 더 높은 단계');
});

test('끌 수 있는 범위: 끝까지 끌면 목적지가 화면에서 완전히 빠지지만 그보다 멀리는 못 감', () => {
  const dest = destinationRect();
  const W = 390;
  const H = 430;
  const scale = 1;
  // 아주 멀리 오른쪽 아래로
  const far = clampCamera({ x: 99999, y: 99999, scale }, W, H, dest);
  const v = viewRect(far, W, H);
  assert.ok(v.x0 > dest.x1 && v.y0 > dest.y1, '목적지가 화면 밖');
  assert.ok(v.x0 - dest.x1 < (W / scale) * 0.1, '한 화면보다 훨씬 멀리는 못 감');
  // 왼쪽 위로
  const farUp = clampCamera({ x: -99999, y: -99999, scale }, W, H, dest);
  const u = viewRect(farUp, W, H);
  assert.ok(u.x1 < dest.x0 && u.y1 < dest.y0);
  // 범위 안이면 그대로
  const mid = { x: dest.x0 + 10, y: dest.y0 + 10, scale };
  assert.deepEqual(clampCamera(mid, W, H, dest), mid);
});

test('확대 한도: 가장 작게는 목적지 전체가 한 화면, 가장 크게는 그보다 큼', () => {
  const dest = destinationRect();
  const { min, max } = scaleLimits(390, 430, dest);
  assert.ok((dest.x1 - dest.x0) * min <= 390 + 1e-9 && (dest.y1 - dest.y0) * min <= 430 + 1e-9);
  assert.ok(max > min * 10);
});

test('두 손가락 확대: 손가락 가운데 아래 점은 그대로, 장소 가운데 카메라', () => {
  const cam = { x: 100, y: 200, scale: 1 };
  const z = zoomAround(cam, 2, 50, 80);
  near(z.x + 50 / 2, cam.x + 50);
  near(z.y + 80 / 2, cam.y + 80);
  const on = cameraOn({ x: 400, y: 300 }, 4, 390, 430);
  near(on.x + 390 / 2 / 4, 400);
  near(on.y + 430 / 2 / 4, 300);
});
