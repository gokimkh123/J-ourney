import test from 'node:test';
import assert from 'node:assert/strict';

import type { RouteDay, RouteStop } from '../meeting/types.ts';
import { addSight, changeCount, createDraft, draftEdits, draftRows, dropRow, moveRow, removeRow, restoreRow, swapMeal, type PlanDraft } from './planDraft.ts';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const sight = (itemId: string): RouteStop => ({ itemId, name: `${itemId} 이름`, lat: 35, lng: 129, placeId: `plc_${itemId}` });
const meal = (itemId: string, when: 'lunch' | 'dinner'): RouteStop => ({ itemId, name: `${itemId} 식당`, lat: 35, lng: 129, placeId: `plc_${itemId}`, kind: 'food', meal: when });

const ROUTE: RouteDay[] = [
  { day: 1, stops: [sight('s1'), meal('f1', 'lunch'), sight('s2'), sight('s3'), meal('f2', 'dinner'), { itemId: 'h1', name: '호텔', lat: 35, lng: 129, placeId: 'plc_h1', kind: 'lodging' }] },
  { day: 2, stops: [sight('s4'), meal('f3', 'lunch')] },
  { day: 3, stops: [sight('s5')] },
];

const base = freeze(createDraft(ROUTE, 7));
const keys = (d: PlanDraft, day = 0) => draftRows(d, day).map((r) => r.key);
const row = (d: PlanDraft, day: number, key: string) => draftRows(d, day).find((r) => r.key === key);

test('끌 수 있는 줄: 관광지·끼니 식당(숙소·뺀 곳은 아님), 그날 하나뿐이면 못 끈다', () => {
  assert.deepEqual(draftRows(base, 0).filter((r) => r.canDrag).map((r) => r.key), ['s1', 'f1', 's2', 's3', 'f2']);
  assert.equal(row(base, 2, 's5')?.canDrag, false);
  assert.equal(row(removeRow(base, 's2'), 0, 's2')?.canDrag, false);
});

test('식사를 끌어 옮기면 그날 전체 순서를 맨 뒤에 placeIds로 보낸다', () => {
  const d = dropRow(base, 0, 'f1', 's2');
  assert.deepEqual(keys(d), ['s1', 's2', 'f1', 's3', 'f2', 'h1']);
  assert.equal(row(d, 0, 'f1')?.mark, 'reordered');
  assert.equal(row(d, 0, 's2')?.mark, 'reordered');
  assert.equal(row(d, 0, 's1')?.mark, null);
  assert.deepEqual(draftEdits(d), [{ type: 'reorder', day: 0, placeIds: ['plc_s1', 'plc_s2', 'plc_f1', 'plc_s3', 'plc_f2'] }]);
  assert.equal(changeCount(d), 1);
});

test('점심을 저녁 뒤로 끌면 받지 않는다(서버 규칙)', () => {
  assert.equal(dropRow(base, 0, 'f1', 'f2'), base);
  assert.equal(dropRow(base, 0, 'f2', 's1'), base);
});

test('원래 순서로 돌아오면 그날 순서를 지운다', () => {
  const there = dropRow(base, 0, 's1', 's3');
  assert.deepEqual(keys(there), ['f1', 's2', 's3', 's1', 'f2', 'h1'], '놓은 자리에 끼워 넣는다');
  const back = dropRow(there, 0, 's1', 'f1');
  assert.deepEqual(keys(back), keys(base));
  assert.deepEqual(draftEdits(back), []);
  assert.equal(back.sequence, undefined);
});

test('끌기는 끌 수 있는 줄끼리만 자리를 바꾸고 뺀 곳은 제자리', () => {
  const removed = removeRow(base, 's2');
  const d = dropRow(removed, 0, 's3', 's1');
  // 끌 줄 [s1 f1 s3 f2]에서 s3를 s1 자리에 끼우면 [s3 s1 f1 f2], 뺀 s2는 셋째 칸 그대로
  assert.deepEqual(keys(d), ['s3', 's1', 's2', 'f1', 'f2', 'h1']);
  assert.equal(row(d, 0, 's2')?.mark, 'removed');
  // 뺀 곳은 reorder에 넣지 않는다(빼기가 먼저 반영됨)
  assert.deepEqual(draftEdits(d), [
    { type: 'remove', itemId: 's2' },
    { type: 'reorder', day: 0, placeIds: ['plc_s3', 'plc_s1', 'plc_f1', 'plc_f2'] },
  ]);
});

test('넣은 곳·옮겨 온 곳도 끌어 순서를 정하고, reorder는 add·move 뒤에 장소 id로 보낸다', () => {
  let d = addSight(base, { placeId: 'plc_9', name: '감천', lat: 35, lng: 129, category: null }, 0);
  d = moveRow(d, 's4', 0);
  assert.equal(row(d, 0, 'add:plc_9')?.canDrag, true);
  assert.equal(row(d, 0, 's4')?.canDrag, true);
  d = dropRow(d, 0, 'add:plc_9', 's1');
  d = dropRow(d, 0, 's4', 'f1');
  assert.deepEqual(keys(d), ['add:plc_9', 's1', 's4', 'f1', 's2', 's3', 'f2', 'h1']);
  assert.equal(row(d, 0, 'add:plc_9')?.mark, 'added', '넣은 곳은 넣은 표시 그대로');
  const edits = draftEdits(d);
  assert.deepEqual(edits.slice(0, 2), [
    { type: 'move', itemId: 's4', day: 0 },
    { type: 'add', placeId: 'plc_9', day: 0 },
  ]);
  const reorder = edits[2];
  assert.ok(reorder !== undefined && reorder.type === 'reorder' && 'placeIds' in reorder);
  assert.deepEqual(reorder.placeIds, ['plc_9', 'plc_s1', 'plc_s4', 'plc_f1', 'plc_s2', 'plc_s3', 'plc_f2']);
  assert.equal(edits.length, 3);
});

test('끈 뒤에 넣은 곳은 저녁 앞(저녁이 없으면 끝)에 붙고 reorder에도 들어간다', () => {
  let d = dropRow(base, 0, 's3', 's1');
  d = addSight(d, { placeId: 'plc_9', name: '감천', lat: 35, lng: 129, category: null }, 0);
  assert.deepEqual(keys(d), ['s3', 's1', 'f1', 's2', 'add:plc_9', 'f2', 'h1']);
  const last = draftEdits(d).at(-1);
  assert.ok(last !== undefined && last.type === 'reorder' && 'placeIds' in last);
  assert.deepEqual(last.placeIds, ['plc_s3', 'plc_s1', 'plc_f1', 'plc_s2', 'plc_9', 'plc_f2']);
  // 저녁이 없는 날은 끝
  let e = dropRow(base, 1, 'f3', 's4');
  e = moveRow(e, 's5', 1);
  assert.deepEqual(keys(e, 1), ['f3', 's4', 's5']);
});

test('끌어서 자리가 바뀐 줄을 되돌리면 그날 끈 순서 전체가 원래대로', () => {
  const d = dropRow(base, 0, 'f1', 's2');
  const back = restoreRow(d, 'f1');
  assert.deepEqual(keys(back), keys(base));
  assert.deepEqual(draftEdits(back), []);
  // 자리가 그대로인 줄은 되돌릴 것이 없다
  assert.equal(restoreRow(d, 's1'), d);
});

test('바꾼 식당도 끌 수 있고, 식당 바꾸기와 순서를 같이 보낸다', () => {
  let d = swapMeal(base, 'f1', { placeId: 'plc_99', name: '새 식당' });
  d = dropRow(d, 0, 'f1', 's2');
  assert.equal(row(d, 0, 'f1')?.mark, 'swapped');
  assert.deepEqual(draftEdits(d), [
    { type: 'meal', itemId: 'f1', placeId: 'plc_99' },
    { type: 'reorder', day: 0, placeIds: ['plc_s1', 'plc_s2', 'plc_f1', 'plc_s3', 'plc_f2'] },
  ]);
});

test('다른 날을 끌어도 이 날 순서는 그대로, 할 수 없는 끌기는 같은 초안', () => {
  const d = dropRow(base, 1, 'f3', 's4');
  assert.deepEqual(keys(d, 1), ['f3', 's4']);
  assert.deepEqual(keys(d, 0), keys(base, 0));
  assert.equal(dropRow(base, 0, 'h1', 's1'), base);
  assert.equal(dropRow(base, 0, 's1', 's1'), base);
  assert.equal(dropRow(base, 0, 's1', 'nope'), base);
});
