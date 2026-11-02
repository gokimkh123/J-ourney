import test from 'node:test';
import assert from 'node:assert/strict';

import type { RouteDay, RouteStop } from '../meeting/types.ts';
import {
  addSight,
  changeCount,
  createDraft,
  draftEdits,
  draftRows,
  moveRow,
  removeRow,
  restoreRow,
  shiftRow,
  swapMeal,
  type PlanDraft,
} from './planDraft.ts';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** kind 없는 곳은 관광지 */
const sight = (itemId: string): RouteStop => ({ itemId, name: `${itemId} 이름`, lat: 35, lng: 129, placeId: `plc_${itemId}` });

const ROUTE: RouteDay[] = [
  {
    day: 1,
    stops: [
      sight('s1'),
      sight('s2'),
      { itemId: 'f1', name: '밀면집', lat: 35, lng: 129, kind: 'food', meal: 'lunch' },
      sight('s3'),
      { itemId: 'h1', name: '바다호텔', lat: 35, lng: 129, kind: 'lodging' },
    ],
  },
  { day: 2, stops: [sight('s4'), { itemId: 'f2', name: '횟집', lat: 35, lng: 129, kind: 'food', meal: 'dinner' }] },
  { day: 3, stops: [sight('s5')] },
];

const base = freeze(createDraft(ROUTE, 3));
const PLACE = { placeId: 'plc_9', name: '감천문화마을', lat: 35.1, lng: 129.0, category: null };

const keys = (d: PlanDraft, day: number) => draftRows(d, day).map((r) => r.key);
const row = (d: PlanDraft, day: number, key: string) => draftRows(d, day).find((r) => r.key === key);

test('createDraft 직후 바뀐 것이 없고 원래 순서 그대로다', () => {
  assert.deepEqual(draftEdits(base), []);
  assert.equal(changeCount(base), 0);
  assert.deepEqual(keys(base, 0), ['s1', 's2', 'f1', 's3', 'h1']);
  assert.ok(draftRows(base, 0).every((r) => r.mark === null));
  assert.equal(row(base, 0, 's1')?.canUp, false);
  assert.equal(row(base, 0, 's3')?.canDown, false);
  assert.equal(row(base, 0, 'f1')?.canSwap, true);
  assert.deepEqual(
    [row(base, 0, 'h1')?.canMove, row(base, 0, 'h1')?.canRemove, row(base, 0, 'h1')?.canSwap],
    [false, false, false],
  );
});

test('빼기와 되돌리기', () => {
  const removed = removeRow(base, 's2');
  assert.deepEqual(draftEdits(removed), [{ type: 'remove', itemId: 's2' }]);
  assert.equal(row(removed, 0, 's2')?.mark, 'removed');
  assert.equal(row(removed, 0, 's2')?.canRestore, true);
  assert.equal(row(removed, 0, 's2')?.canRemove, false);
  assert.deepEqual(draftEdits(restoreRow(removed, 's2')), []);
});

test('순서 바꾸기는 관광지 칸만 바꾸고, 원래 순서로 돌아오면 order를 지운다', () => {
  const shifted = shiftRow(base, 's3', 'up');
  assert.deepEqual(draftEdits(shifted), [{ type: 'reorder', day: 0, itemIds: ['s1', 's3', 's2'] }]);
  assert.deepEqual(keys(shifted, 0), ['s1', 's3', 'f1', 's2', 'h1']);
  assert.deepEqual(draftRows(shifted, 0).map((r) => r.mark), [null, 'reordered', null, 'reordered', null]);
  assert.equal(row(shifted, 0, 's3')?.canRestore, true);

  const back = shiftRow(shifted, 's3', 'down');
  assert.deepEqual(back.order, {});
  assert.deepEqual(draftEdits(back), []);
  assert.deepEqual(draftEdits(restoreRow(shifted, 's2')), []);
});

test('다른 날로 옮기면 그날 관광지 뒤에 붙고, 원래 날로 옮기면 제자리다', () => {
  const moved = moveRow(base, 's1', 1);
  assert.deepEqual(draftEdits(moved), [{ type: 'move', itemId: 's1', day: 1 }]);
  assert.deepEqual(keys(moved, 1), ['s4', 's1', 'f2']);
  assert.equal(row(moved, 1, 's1')?.mark, 'moved');
  assert.equal(row(moved, 1, 's1')?.canRestore, true);
  assert.deepEqual(keys(moved, 0), ['s2', 's3', 'f1', 'h1']);
  assert.deepEqual(draftEdits(moveRow(moved, 's1', 0)), []);
});

test('관광지 넣기: 같은 곳은 한 번만, 뺀 원래 곳이면 빼기를 되돌리고, removeRow로 지운다', () => {
  const added = addSight(base, PLACE, 2);
  assert.deepEqual(keys(added, 2), ['s5', 'add:plc_9']);
  assert.equal(row(added, 2, 'add:plc_9')?.mark, 'added');
  assert.equal(row(added, 2, 'add:plc_9')?.canRestore, false);
  assert.equal(addSight(added, PLACE, 0), added);
  assert.equal(addSight(base, { ...PLACE, placeId: 'plc_s1' }, 0), base);
  assert.deepEqual(draftEdits(addSight(removeRow(base, 's2'), { ...PLACE, placeId: 'plc_s2' }, 0)), []);

  const cleared = removeRow(added, 'add:plc_9');
  assert.deepEqual(keys(cleared, 2), ['s5']);
  assert.deepEqual(draftEdits(cleared), []);
});

test('식당 바꾸기는 끼니 식당만, 숙소는 고칠 수 없다', () => {
  const swapped = swapMeal(base, 'f1', { placeId: 'plc_7', name: '돼지국밥' });
  const f1 = row(swapped, 0, 'f1');
  assert.equal(f1?.name, '돼지국밥');
  assert.equal(f1?.originalName, '밀면집');
  assert.equal(f1?.mark, 'swapped');
  assert.equal(f1?.canRestore, true);
  assert.deepEqual(draftEdits(restoreRow(swapped, 'f1')), []);
  assert.equal(swapMeal(base, 's1', { placeId: 'plc_7', name: '돼지국밥' }), base);
  assert.equal(removeRow(base, 'h1'), base);
});

test('섞어서 고치면 reorder → remove → move → add → meal 순서로 보낸다', () => {
  let d = shiftRow(base, 's3', 'up');
  d = removeRow(d, 's1');
  d = moveRow(d, 's2', 1);
  d = addSight(d, PLACE, 0);
  d = swapMeal(d, 'f2', { placeId: null, name: null });
  assert.deepEqual(draftEdits(d), [
    { type: 'reorder', day: 0, itemIds: ['s1', 's3', 's2'] },
    { type: 'remove', itemId: 's1' },
    { type: 'move', itemId: 's2', day: 1 },
    { type: 'add', placeId: 'plc_9', day: 0 },
    { type: 'meal', itemId: 'f2', placeId: null },
  ]);
  assert.equal(changeCount(d), 5);
  assert.deepEqual(keys(d, 0), ['s1', 's3', 'f1', 'add:plc_9', 'h1']);
  assert.deepEqual(keys(d, 1), ['s4', 's2', 'f2']);
  assert.equal(row(d, 1, 'f2')?.name, '아무 데나');
});

test('할 수 없는 조작은 같은 객체를 돌려주고, 원래 초안은 바뀌지 않는다', () => {
  const added = addSight(base, PLACE, 0);
  assert.equal(shiftRow(base, 's1', 'up'), base);
  assert.equal(shiftRow(base, 's3', 'down'), base);
  assert.equal(removeRow(base, 'nope'), base);
  assert.equal(restoreRow(base, 's1'), base);
  assert.equal(moveRow(base, 's1', 3), base);
  assert.equal(moveRow(base, 's1', 0), base);
  assert.equal(shiftRow(added, 'add:plc_9', 'up'), added);
  assert.deepEqual(base, createDraft(ROUTE, 3));
});
