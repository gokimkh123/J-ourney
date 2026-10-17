import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeKindOf } from './placeKind.ts';

test('알려진 분류는 맞는 스티커로 바뀐다', () => {
  assert.equal(placeKindOf('food'), 'food');
  assert.equal(placeKindOf('cafe'), 'cafe');
  assert.equal(placeKindOf('market'), 'market');
  assert.equal(placeKindOf('sightseeing'), 'view');
  assert.equal(placeKindOf('walk'), 'beach');
});

test('모르는 분류와 객체 기본 속성 이름은 기본 핀', () => {
  assert.equal(placeKindOf('spa'), 'pin');
  assert.equal(placeKindOf('toString'), 'pin');
  assert.equal(placeKindOf(''), 'pin');
});
