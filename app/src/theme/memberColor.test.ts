import assert from "node:assert/strict";
import { test } from "node:test";

import { backdrop, outline, pastel } from "./memberColor.ts";

// 기대값은 디자인 원본(docs/app/design-mood/source/beanlib.js)의 pastel·outline으로 구한 값이다.
const GOLDEN: [string, string, string][] = [
  ["#F97316", "#F0BD99", "#B0774F"],
  ["#EC4899", "#EB9DC4", "#AE517F"],
  ["#0EA5E9", "#9AD5EF", "#4F92B0"],
  ["#10B981", "#9CEDD2", "#4FB090"],
  ["#6C5CE7", "#A9A1E8", "#5F55AA"],
];

test("pastel·outline은 디자인 원본과 같은 값을 낸다", () => {
  for (const [hex, p, o] of GOLDEN) {
    assert.equal(pastel(hex), p, `pastel ${hex}`);
    assert.equal(outline(hex), o, `outline ${hex}`);
  }
});

test("잘못된 hex는 입력을 그대로 돌려준다", () => {
  for (const bad of ["", "red", "#12", "#GGGGGG", "rgb(0,0,0)"]) {
    assert.equal(pastel(bad), bad);
    assert.equal(outline(bad), bad);
    assert.equal(backdrop(bad, "light"), bad);
  }
});

test("backdrop은 밝은 모드에서 몸통보다 옅고 다크 모드에서 더 진하다", () => {
  const lightness = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
  };
  for (const hex of ["#F97316", "#EC4899", "#0EA5E9", "#10B981"]) {
    assert.ok(lightness(backdrop(hex, "light")) > lightness(pastel(hex)), `light ${hex}`);
    assert.ok(lightness(backdrop(hex, "dark")) < lightness(pastel(hex)), `dark ${hex}`);
  }
});
