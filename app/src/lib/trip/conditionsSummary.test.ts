import test from 'node:test';
import assert from 'node:assert/strict';

import { conditionsDates, conditionsSummary } from './conditionsSummary.ts';
import type { ConditionsBody } from './conditions.ts';

const body: ConditionsBody = {
  destination: '부산',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  budgetPerPerson: 300000,
  transport: '대중교통',
  rules: { aiMinSatisfaction: 7, maxRounds: 5 },
};

test('한 줄 요약', () => {
  assert.equal(conditionsSummary(body), '부산 · 1박 2일 · 1인 300,000원 · 대중교통');
  assert.equal(conditionsSummary({ ...body, endDate: '2026-11-14' }), '부산 · 당일 · 1인 300,000원 · 대중교통');
});

test('날짜 범위 글자', () => {
  assert.equal(conditionsDates(body), '11월 14일 (토) ~ 11월 15일 (일)');
  assert.equal(conditionsDates({ ...body, endDate: '2026-11-14' }), '11월 14일 (토)');
});
