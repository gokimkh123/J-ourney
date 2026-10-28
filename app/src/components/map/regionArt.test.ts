import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ART_H,
  ART_W,
  VIEW_W,
  cameraXY,
  computeArtViewport,
  projectGeo,
  shade,
  smoothPath,
} from "./regionArt.ts";

const KM_PER_LAT = 111.2;
const KM_PER_LNG = 111.32 * Math.cos((35.1 * Math.PI) / 180);

test("그림 모서리(서쪽 128.70, 북쪽 35.45)가 원점, 동쪽 129.40·남쪽 34.90이 반대편 모서리", () => {
  const nw = projectGeo({ lat: 35.45, lng: 128.7 });
  assert.ok(Math.abs(nw.x) < 1e-9 && Math.abs(nw.y) < 1e-9);
  const se = projectGeo({ lat: 34.9, lng: 129.4 });
  assert.ok(Math.abs(se.x - ART_W) < 1 && Math.abs(se.y - ART_H) < 1);
});

test("거리 비율이 실제와 같다(가로·세로 모두 1km에 약 16px)", () => {
  const a = projectGeo({ lat: 35.1, lng: 129.0 });
  const east = projectGeo({ lat: 35.1, lng: 129.0 + 1 / KM_PER_LNG });
  const north = projectGeo({ lat: 35.1 + 1 / KM_PER_LAT, lng: 129.0 });
  assert.ok(Math.abs(east.x - a.x - 16) < 0.5 && Math.abs(east.y - a.y) < 1e-9);
  assert.ok(Math.abs(a.y - north.y - 16) < 0.5 && Math.abs(north.x - a.x) < 1e-9);
});

test("동쪽일수록 x가 크고 북쪽일수록 y가 작다", () => {
  const jagalchi = projectGeo({ lat: 35.0967, lng: 129.0305 });
  const haeundae = projectGeo({ lat: 35.1587, lng: 129.1604 });
  const beomeosa = projectGeo({ lat: 35.2823, lng: 129.0679 });
  assert.ok(haeundae.x > jagalchi.x);
  assert.ok(beomeosa.y < jagalchi.y);
});

test("부산 전역(다대포~대변항, 가덕도~기장)이 모두 그림 안에 든다", () => {
  for (const p of [
    { lat: 35.0472, lng: 128.9658 },
    { lat: 35.2263, lng: 129.2272 },
    { lat: 35.2823, lng: 129.0679 },
    { lat: 35.1587, lng: 129.1604 },
  ]) {
    const q = projectGeo(p);
    assert.ok(q.x > 0 && q.x < ART_W && q.y > 0 && q.y < ART_H, JSON.stringify(p));
  }
});

test("이상한 값에서도 유한하다", () => {
  for (const p of [
    { lat: Number.NaN, lng: 129 },
    { lat: 35, lng: Number.POSITIVE_INFINITY },
    { lat: 0, lng: 0 },
    { lat: -80, lng: 170 },
  ]) {
    const q = projectGeo(p);
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
  }
});

const inside = (v: { x: number; y: number; w: number; h: number }) =>
  v.x >= -1e-9 && v.y >= -1e-9 && v.x + v.w <= ART_W + 1e-9 && v.y + v.h <= ART_H + 1e-9;

test("fit 보기는 항상 그림 안이고 점을 담는다", () => {
  const sets = [
    [{ x: 400, y: 600 }, { x: 650, y: 500 }],
    [{ x: 5, y: 5 }],
    [{ x: 1015, y: 970 }, { x: 1010, y: 960 }],
    [{ x: 0, y: 0 }, { x: ART_W, y: ART_H }],
  ];
  for (const pts of sets) {
    const v = computeArtViewport(pts, 360, 220, "fit");
    assert.ok(inside(v), JSON.stringify(v));
    assert.ok(v.scale <= 2.2 + 1e-9 && v.scale > 0);
    assert.ok(Math.abs(v.w / v.h - 360 / 220) < 1e-6);
  }
  const pts = [{ x: 400, y: 600 }, { x: 650, y: 500 }];
  const v = computeArtViewport(pts, 360, 220, "fit");
  for (const p of pts) assert.ok(p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h);
});

test("full 보기는 폭 VIEW_W로 고정되고 그림 안이다", () => {
  const pts = [{ x: 390, y: 700 }, { x: 650, y: 500 }, { x: 560, y: 640 }];
  for (const [cw, ch] of [[390, 350], [430, 600], [360, 300]] as const) {
    const v = computeArtViewport(pts, cw, ch, "full");
    assert.equal(v.w, VIEW_W);
    assert.ok(Math.abs(v.scale - cw / VIEW_W) < 1e-9);
    assert.ok(Math.abs(v.h - ch / v.scale) < 1e-9);
    assert.ok(inside(v), JSON.stringify(v));
  }
});

test("full 보기: 점이 한 화면에 들면 가운데로, 위쪽엔 말하는 캐릭터 자리가 남는다", () => {
  const pts = [{ x: 500, y: 500 }, { x: 560, y: 560 }];
  const v = computeArtViewport(pts, 390, 400, "full");
  assert.ok(pts.every((p) => p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h));
  assert.ok(500 - v.y >= 120 - 1e-6, "맨 위 점 위로 120px");
});

test("full 보기: 점이 한 화면보다 넓게 흩어지면 왼쪽·위쪽 점부터 맞추고 그림 밖으로 나가지 않는다", () => {
  const pts = [{ x: 100, y: 100 }, { x: 900, y: 900 }];
  const v = computeArtViewport(pts, 390, 350, "full");
  assert.ok(inside(v));
  assert.ok(pts[0]!.x >= v.x && pts[0]!.y >= v.y);
});

test("full 보기: 점이 없으면 부산 한가운데를 보여 준다", () => {
  const v = computeArtViewport([], 390, 400, "full");
  assert.ok(inside(v));
  const home = projectGeo({ lat: 35.115, lng: 129.04 });
  assert.ok(home.x >= v.x && home.x <= v.x + v.w && home.y >= v.y && home.y <= v.y + v.h);
});

test("컨테이너 크기가 0이어도 깨지지 않는다", () => {
  for (const view of ["full", "fit"] as const) {
    const v = computeArtViewport([{ x: 500, y: 500 }], 0, 0, view);
    assert.ok(Number.isFinite(v.x + v.y + v.w + v.h + v.scale));
  }
});

test("cameraXY: 처음엔 이상적인 위치, 조금 어긋나면 그대로, 많이 어긋나면 옮긴다", () => {
  const pts = [{ x: 500, y: 600 }];
  const first = cameraXY(null, pts, 390, 350);
  const ideal = computeArtViewport(pts, 390, 350, "full");
  assert.deepEqual(first, { x: ideal.x, y: ideal.y });
  // 점이 가로·세로로 20px 움직여도 카메라는 그대로
  assert.equal(cameraXY(first, [{ x: 515, y: 585 }], 390, 350), first);
  // 점이 오른쪽으로 200px 가면 새 위치로
  const moved = cameraXY(first, [{ x: 700, y: 600 }], 390, 350);
  assert.notEqual(moved, first);
  assert.deepEqual(moved, { x: computeArtViewport([{ x: 700, y: 600 }], 390, 350, "full").x, y: first.y });
  // 위로 200px 가도 마찬가지
  const up = cameraXY(first, [{ x: 500, y: 400 }], 390, 350);
  assert.notEqual(up, first);
});

test("cameraXY: 어긋난 거리는 화면 픽셀로 잰다(화면이 넓으면 같은 어긋남도 더 크다)", () => {
  const first = cameraXY(null, [{ x: 500, y: 600 }], 390, 350);
  // 그림 좌표로 30만큼: 폭 390에서는 30px < 40이라 그대로, 폭 780(2배 배율)에서는 60px이라 움직인다
  const shifted = [{ x: 530, y: 600 }];
  assert.equal(cameraXY(first, shifted, 390, 350), first);
  const first2x = cameraXY(null, [{ x: 500, y: 600 }], 780, 700);
  assert.notEqual(cameraXY(first2x, shifted, 780, 700), first2x);
});

test("smoothPath는 점 n개를 곡선 n-1개로 잇는다", () => {
  assert.equal(smoothPath([]), "");
  assert.equal(smoothPath([{ x: 1, y: 1 }]), "");
  const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
  assert.ok(d.startsWith("M0 0"));
  assert.equal(d.split("C").length - 1, 2);
  assert.ok(d.endsWith("20 0"));
});

test("shade", () => {
  assert.equal(shade("#FFB4A2", 0.5), "#805A51");
  assert.equal(shade("#FFFFFF", 2), "#FFFFFF");
  assert.equal(shade("red", 0.5), "red");
});

test("full 보기: 점이 한 화면에 안 들면 focus(움직이는 점)를 먼저 담는다", () => {
  const pins = [{ x: 400, y: 700 }, { x: 760, y: 300 }, { x: 600, y: 520 }];
  const focus = [{ x: 600, y: 520 }, { x: 640, y: 540 }];
  const plain = computeArtViewport(pins, 390, 520, "full");
  const focused = computeArtViewport(pins, 390, 520, "full", focus);
  assert.ok(inside(focused));
  assert.ok(focus.every((p) => p.x >= focused.x && p.x <= focused.x + focused.w && p.y >= focused.y && p.y <= focused.y + focused.h));
  // focus 없이는 왼쪽·위쪽 점부터 맞추므로 focus 점이 잘릴 수 있다
  assert.notDeepEqual({ x: plain.x, y: plain.y }, { x: focused.x, y: focused.y });
});

test("full 보기: 다 담을 수 있으면 focus와 상관없이 점 전체를 담는다", () => {
  const pins = [{ x: 500, y: 500 }, { x: 560, y: 560 }];
  const all = computeArtViewport(pins, 390, 400, "full");
  const withFocus = computeArtViewport(pins, 390, 400, "full", [{ x: 560, y: 560 }]);
  assert.deepEqual(withFocus, all);
});

test("cameraXY도 focus를 따른다", () => {
  const pins = [{ x: 400, y: 700 }, { x: 760, y: 300 }];
  const focus = [{ x: 400, y: 700 }];
  const cam = cameraXY(null, pins, 390, 520, focus);
  const v = computeArtViewport(pins, 390, 520, "full", focus);
  assert.deepEqual(cam, { x: v.x, y: v.y });
});
