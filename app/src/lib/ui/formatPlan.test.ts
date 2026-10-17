import test from 'node:test';
import assert from 'node:assert/strict';

import { categoryLabel, crowdLabel, moveModeLabel } from './format.ts';

test('moveModeLabel: 알려진 값과 모르는 값', () => {
  assert.equal(moveModeLabel('walk'), '도보');
  assert.equal(moveModeLabel('bus'), '버스');
  assert.equal(moveModeLabel('subway'), '지하철');
  assert.equal(moveModeLabel('taxi'), '택시');
  assert.equal(moveModeLabel('car'), '자동차');
  assert.equal(moveModeLabel('ferry'), 'ferry');
  assert.equal(moveModeLabel(''), '');
  assert.equal(moveModeLabel('constructor'), 'constructor');
});

test('categoryLabel: 알려진 값과 모르는 값', () => {
  assert.equal(categoryLabel('food'), '식사');
  assert.equal(categoryLabel('cafe'), '카페');
  assert.equal(categoryLabel('sightseeing'), '관광');
  assert.equal(categoryLabel('market'), '시장');
  assert.equal(categoryLabel('spa'), '휴식');
  assert.equal(categoryLabel('walk'), '산책');
  assert.equal(categoryLabel('shopping'), 'shopping');
  assert.equal(categoryLabel('constructor'), 'constructor');
  assert.equal(categoryLabel('toString'), 'toString');
});

test('crowdLabel: 경계값', () => {
  assert.equal(crowdLabel(0), '한산');
  assert.equal(crowdLabel(33), '한산');
  assert.equal(crowdLabel(33.5), '보통');
  assert.equal(crowdLabel(34), '보통');
  assert.equal(crowdLabel(66), '보통');
  assert.equal(crowdLabel(66.5), '붐빔');
  assert.equal(crowdLabel(67), '붐빔');
  assert.equal(crowdLabel(100), '붐빔');
});

test('crowdLabel: 범위 밖과 NaN은 정보 없음', () => {
  assert.equal(crowdLabel(-1), '정보 없음');
  assert.equal(crowdLabel(101), '정보 없음');
  assert.equal(crowdLabel(Number.NaN), '정보 없음');
});
