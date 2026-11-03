import test from 'node:test';
import assert from 'node:assert/strict';

import type { RouteDay, RouteStop } from '../meeting/types.ts';
import { createDraft, dropBreaksMealOrder, dropRow } from './planDraft.ts';

const sight = (itemId: string): RouteStop => ({ itemId, name: `${itemId} 이름`, lat: 35, lng: 129, placeId: `plc_${itemId}` });
const meal = (itemId: string, when: 'lunch' | 'dinner'): RouteStop => ({ itemId, name: `${itemId} 식당`, lat: 35, lng: 129, placeId: `plc_${itemId}`, kind: 'food', meal: when });

const ROUTE: RouteDay[] = [
  { day: 1, stops: [sight('s1'), meal('f1', 'lunch'), sight('s2'), meal('f2', 'dinner')] },
  { day: 2, stops: [sight('s3'), meal('f3', 'lunch'), sight('s4')] },
];
const base = createDraft(ROUTE, 3);

test('점심을 저녁 뒤로, 저녁을 점심 앞으로 끄는 것은 까닭을 알릴 끌기다(서버가 받지 않음)', () => {
  assert.equal(dropBreaksMealOrder(base, 0, 'f1', 'f2'), true);
  assert.equal(dropBreaksMealOrder(base, 0, 'f2', 's1'), true);
  // 알릴 끌기면 초안도 그대로다(화면은 제자리로 돌린다).
  assert.equal(dropRow(base, 0, 'f1', 'f2'), base);
});

test('점심이 저녁 앞에 남는 끌기와 저녁이 없는 날은 알리지 않는다', () => {
  assert.equal(dropBreaksMealOrder(base, 0, 'f1', 's2'), false);
  assert.equal(dropBreaksMealOrder(base, 0, 's1', 'f2'), false);
  assert.equal(dropBreaksMealOrder(base, 1, 'f3', 's4'), false);
});

test('제자리·없는 줄은 알리지 않는다', () => {
  assert.equal(dropBreaksMealOrder(base, 0, 'f1', 'f1'), false);
  assert.equal(dropBreaksMealOrder(base, 0, 'nope', 'f2'), false);
});
