import test from 'node:test';
import assert from 'node:assert/strict';

import { formatWon, nightsLabel } from './format.ts';

test('formatWon: 천 단위 쉼표와 원', () => {
  assert.equal(formatWon(0), '0원');
  assert.equal(formatWon(999), '999원');
  assert.equal(formatWon(1000), '1,000원');
  assert.equal(formatWon(1500), '1,500원');
  assert.equal(formatWon(250000), '250,000원');
  assert.equal(formatWon(1000000), '1,000,000원');
  assert.equal(formatWon(1234567), '1,234,567원');
});

test('nightsLabel: 당일, 박수 계산, 월·연도 경계', () => {
  assert.equal(nightsLabel('2026-11-14', '2026-11-14'), '당일');
  assert.equal(nightsLabel('2026-11-14', '2026-11-15'), '1박 2일');
  assert.equal(nightsLabel('2026-11-14', '2026-11-16'), '2박 3일');
  assert.equal(nightsLabel('2026-11-30', '2026-12-02'), '2박 3일');
  assert.equal(nightsLabel('2026-12-31', '2027-01-01'), '1박 2일');
  assert.equal(nightsLabel('2028-02-28', '2028-03-01'), '2박 3일');
});
