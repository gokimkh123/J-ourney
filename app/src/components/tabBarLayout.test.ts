import assert from "node:assert/strict";
import { test } from "node:test";

import { FOCUSED_FLEX, tabFlexes } from "./tabBarLayout.ts";

test("켜진 탭만 넓다", () => {
  assert.deepEqual(tabFlexes(4, 2), [1, 1, FOCUSED_FLEX, 1]);
  assert.deepEqual(tabFlexes(5, 0), [FOCUSED_FLEX, 1, 1, 1, 1]);
  assert.equal(FOCUSED_FLEX, 1.9);
});

test("범위 밖이면 전부 1", () => {
  assert.deepEqual(tabFlexes(3, -1), [1, 1, 1]);
  assert.deepEqual(tabFlexes(3, 3), [1, 1, 1]);
  assert.deepEqual(tabFlexes(3, 1.5), [1, 1, 1]);
});

test("탭이 없거나 개수가 이상하면 빈 배열", () => {
  assert.deepEqual(tabFlexes(0, 0), []);
  assert.deepEqual(tabFlexes(-2, 0), []);
  assert.deepEqual(tabFlexes(Number.NaN, 0), []);
});
