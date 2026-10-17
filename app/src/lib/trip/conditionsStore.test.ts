import test from 'node:test';
import assert from 'node:assert/strict';

import { createConditionsStore } from './conditionsStore.ts';
import type { ConditionsBody } from './conditions.ts';

const body: ConditionsBody = {
  destination: '부산',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  budgetPerPerson: 300000,
  transport: '대중교통',
  rules: { aiMinSatisfaction: 7, maxRounds: 5 },
};

test('저장하면 읽을 수 있고 구독자를 부른다', () => {
  const store = createConditionsStore();
  assert.equal(store.get(), null);
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  store.set(body);
  assert.equal(store.get(), body);
  assert.equal(calls, 1);
  store.set(null);
  assert.equal(store.get(), null);
  assert.equal(calls, 2);
  off();
  store.set(body);
  assert.equal(calls, 2);
});
