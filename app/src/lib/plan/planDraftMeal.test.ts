import test from 'node:test';
import assert from 'node:assert/strict';

import type { RouteDay } from '../meeting/types.ts';
import { createDraft, draftEdits, draftRows, swapMeal } from './planDraft.ts';

// 끼니 식당만 바꿀 수 있다: meal 칸이 붙어 있어도 식당(food)이 아니면 무시(하네스 통합 단계가 찾은 경계, 11/1)

const route: RouteDay[] = [
  {
    day: 1,
    stops: [
      { itemId: 's1', name: '감천', lat: 35, lng: 129, meal: 'lunch' },
      { itemId: 'f1', name: '국밥', lat: 35, lng: 129, kind: 'food', meal: 'lunch' },
      { itemId: 'h1', name: '숙소', lat: 35, lng: 129, kind: 'lodging', meal: 'dinner' },
    ],
  },
];

test('meal이 붙은 숙소·kind 없는 관광지에 swapMeal은 같은 초안을 돌려준다', () => {
  const d = createDraft(route, 1);
  assert.equal(swapMeal(d, 'h1', { placeId: 'p', name: '다른 곳' }), d);
  assert.equal(swapMeal(d, 's1', { placeId: 'p', name: '다른 곳' }), d);
});

test('식당은 바꿀 수 있고, 숙소·관광지 줄에는 바꾸기가 없다', () => {
  const d = swapMeal(createDraft(route, 1), 'f1', { placeId: 'p', name: '돼지국밥' });
  assert.deepEqual(draftEdits(d), [{ type: 'meal', itemId: 'f1', placeId: 'p' }]);
  const rows = draftRows(createDraft(route, 1), 0);
  assert.deepEqual(rows.map((r) => [r.key, r.canSwap]), [
    ['s1', false],
    ['f1', true],
    ['h1', false],
  ]);
});
