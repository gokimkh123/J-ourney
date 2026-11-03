import assert from 'node:assert/strict';
import test from 'node:test';

import { dropTarget, neighborKey, reorderedKeys, shiftsAfter, type Box, type DragRow } from './dragLayout.ts';

const rows: DragRow[] = [
  { key: 'hotel', draggable: false },
  { key: 'a', draggable: true },
  { key: 'b', draggable: true },
  { key: 'c', draggable: true },
];

// 줄 사이 간격 4, b만 키가 크다(이동 안내 줄이 붙음)
const boxes = new Map<string, Box>([
  ['hotel', { y: 0, h: 50 }],
  ['a', { y: 54, h: 50 }],
  ['b', { y: 108, h: 70 }],
  ['c', { y: 182, h: 50 }],
]);

test('끄는 줄 가운데와 가장 가까운 끌 수 있는 줄이 놓일 자리다(고정 줄은 고르지 않는다)', () => {
  assert.equal(dropTarget(rows, boxes, 'a', 0), 'a');
  assert.equal(dropTarget(rows, boxes, 'a', 70), 'b');
  assert.equal(dropTarget(rows, boxes, 'a', 150), 'c');
  assert.equal(dropTarget(rows, boxes, 'c', -400), 'a');
  assert.equal(dropTarget(rows, new Map(), 'a', 100), 'a');
});

test('끌 수 있는 줄끼리만 자리를 바꾸고 고정 줄은 제자리', () => {
  assert.deepEqual(reorderedKeys(rows, 'c', 'a'), ['hotel', 'c', 'a', 'b']);
  assert.deepEqual(reorderedKeys(rows, 'a', 'c'), ['hotel', 'b', 'c', 'a']);
  assert.deepEqual(reorderedKeys(rows, 'a', 'hotel'), ['hotel', 'a', 'b', 'c']);
});

test('옮긴 뒤 자리로 쌓으면 지나간 줄은 끄는 줄 높이만큼 비켜 준다', () => {
  const shifts = shiftsAfter(rows, boxes, 'a', 'c');
  // 새 순서 hotel, b, c, a: b는 54로(−54), c는 54+70+4=128로(−54), a는 128+50+4=182로(+128)
  assert.deepEqual(Object.fromEntries(shifts), { hotel: 0, b: -54, c: -54, a: 128 });
});

test('키가 다른 줄이 지나가도 그 줄 높이만큼 비켜 준다', () => {
  const shifts = shiftsAfter(rows, boxes, 'c', 'a');
  // 새 순서 hotel, c, a, b: c는 54로(−128), a는 108로(+54), b는 162로(+54)
  assert.deepEqual(Object.fromEntries(shifts), { hotel: 0, c: -128, a: 54, b: 54 });
});

test('자리를 모르는 줄이 있으면 아무것도 움직이지 않는다', () => {
  assert.equal(shiftsAfter(rows, new Map([['a', { y: 0, h: 10 }]]), 'a', 'b').size, 0);
});

test('화면 읽기용 이웃: 끌 수 있는 줄 사이에서만 한 칸', () => {
  assert.equal(neighborKey(rows, 'a', -1), null);
  assert.equal(neighborKey(rows, 'a', 1), 'b');
  assert.equal(neighborKey(rows, 'c', 1), null);
  assert.equal(neighborKey(rows, 'hotel', 1), null);
});
