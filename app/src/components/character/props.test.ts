import assert from "node:assert/strict";
import { test } from "node:test";

import { CHIP_PROP, PROP_SLOT, selectProps } from "./props.ts";

const chips = (...labels: string[]) => labels.map((label) => ({ label }));

test("칩 13개가 모두 소품 하나에 대응한다", () => {
  assert.equal(Object.keys(CHIP_PROP).length, 13);
  for (const key of Object.values(CHIP_PROP)) assert.ok(PROP_SLOT[key], key);
});

test("자리마다 앞쪽(더 강한) 칩 하나만 고른다", () => {
  // 민수: 계획형·부지런형 → 안경 + 캡
  assert.deepEqual(selectProps(chips("계획형", "부지런형")), { face: "glasses", head: "cap" });
  // 지은: 활기형·탐험형 → 헤드폰 + 나침반
  assert.deepEqual(selectProps(chips("활기형", "탐험형")), { head: "phones", hand: "compass" });
  // 현우: 계획형·절약형 → 안경 + 크로스백
  assert.deepEqual(selectProps(chips("계획형", "절약형")), { face: "glasses", body: "bag" });
  // 서연: 느긋형·한적형·늦잠형 → 비니 + 책 + 졸린 눈
  assert.deepEqual(selectProps(chips("느긋형", "한적형", "늦잠형")), { head: "beanie", hand: "book", face: "sleepy" });
});

test("같은 자리 칩이 겹치면 앞쪽이 이긴다", () => {
  assert.deepEqual(selectProps(chips("명소형", "탐험형", "즉흥형")), { hand: "camera" });
  assert.deepEqual(selectProps(chips("아침형", "부지런형")), { head: "bucket" });
  assert.deepEqual(selectProps(chips("늦잠형", "계획형")), { face: "sleepy" });
});

test("매핑에 없는 칩과 상관없음은 무시한다", () => {
  assert.deepEqual(selectProps([]), {});
  assert.deepEqual(selectProps(chips("상관없음", "모르는칩")), {});
  assert.deepEqual(selectProps(chips("상관없음", "투자형")), { body: "scarf" });
  assert.deepEqual(selectProps(chips("뭐든 좋아")), { body: "clover" });
});

test("Object 기본 속성 이름이 칩으로 와도 소품이 되지 않는다", () => {
  assert.deepEqual(selectProps(chips("constructor", "toString", "__proto__")), {});
});
