import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ART_H,
  ART_W,
  BUSAN_ANCHORS,
  computeArtViewport,
  projectBusan,
  shade,
  smoothPath,
} from "./busanArt.ts";

test("앵커는 제 그림 좌표로 간다", () => {
  for (const a of BUSAN_ANCHORS) {
    const p = projectBusan(a);
    assert.ok(Math.abs(p.x - a.x) <= 0.5 && Math.abs(p.y - a.y) <= 0.5, `${a.lat},${a.lng}`);
  }
  const near = projectBusan({ lat: 35.1587 + 0.0003, lng: 129.1604 });
  assert.ok(Math.abs(near.x - 322) < 3 && Math.abs(near.y - 250) < 3);
});

test("동서·남북 순서가 유지된다", () => {
  const haeundae = projectBusan({ lat: 35.1587, lng: 129.1604 });
  const gwangalli = projectBusan({ lat: 35.1532, lng: 129.1186 });
  const jagalchi = projectBusan({ lat: 35.0969, lng: 129.0306 });
  const dongnae = projectBusan({ lat: 35.2048, lng: 129.0837 });
  assert.ok(haeundae.x > gwangalli.x && gwangalli.x > jagalchi.x);
  assert.ok(dongnae.y < jagalchi.y);
});

test("먼 값·이상한 값에서도 유한하다", () => {
  for (const p of [
    { lat: 0, lng: 0 },
    { lat: 37.5, lng: 127 },
    { lat: -80, lng: 170 },
    { lat: 35.1, lng: 129.1 },
  ]) {
    const q = projectBusan(p);
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
  }
});

const inside = (v: { x: number; y: number; w: number; h: number }) =>
  v.x >= -1e-9 && v.y >= -1e-9 && v.x + v.w <= ART_W + 1e-9 && v.y + v.h <= ART_H + 1e-9;

test("fit 보기는 항상 캔버스 안이고 점을 담는다", () => {
  const sets = [
    [{ x: 100, y: 340 }, { x: 322, y: 250 }],
    [{ x: 5, y: 5 }],
    [{ x: 385, y: 505 }, { x: 380, y: 500 }],
    [{ x: 0, y: 0 }, { x: 390, y: 510 }],
  ];
  for (const pts of sets) {
    const v = computeArtViewport(pts, 360, 220, "fit");
    assert.ok(inside(v), JSON.stringify(v));
    assert.ok(v.scale <= 2.2 + 1e-9 && v.scale > 0);
    assert.ok(Math.abs(v.w / v.h - 360 / 220) < 1e-6);
  }
  const v = computeArtViewport([{ x: 100, y: 340 }, { x: 322, y: 250 }], 360, 220, "fit");
  for (const p of [{ x: 100, y: 340 }, { x: 322, y: 250 }]) {
    assert.ok(p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h);
  }
});

test("full 보기는 폭 전체이고 컨테이너가 짧으면 캔버스 안, 길면 아래가 남는다", () => {
  const pts = [{ x: 100, y: 340 }, { x: 322, y: 250 }, { x: 176, y: 404 }];
  const short = computeArtViewport(pts, 390, 420, "full");
  assert.equal(short.w, ART_W);
  assert.ok(inside(short));
  assert.ok(short.y + 0 <= pts[1].y - 120 + 1e-6 || short.y === 0);
  const tall = computeArtViewport(pts, 390, 700, "full");
  assert.equal(tall.y, 0);
  assert.ok(tall.h > ART_H);
  const empty = computeArtViewport([], 360, 300, "full");
  assert.equal(empty.x, 0);
});

test("컨테이너 크기가 0이어도 깨지지 않는다", () => {
  for (const view of ["full", "fit"] as const) {
    const v = computeArtViewport([{ x: 10, y: 10 }], 0, 0, view);
    assert.ok(Number.isFinite(v.x + v.y + v.w + v.h + v.scale));
  }
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
