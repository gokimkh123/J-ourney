import test from 'node:test';
import assert from 'node:assert/strict';

import { validateConditions } from './conditions.ts';
import type { ConditionsInput } from './conditions.ts';

const base: ConditionsInput = {
  destination: '부산',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  budgetPerPerson: 300000,
  transport: '대중교통',
};

test('규칙을 안 주면 기본값 7점·5회', () => {
  const result = validateConditions(base, '2026-10-17');
  assert.ok(result.ok);
  assert.deepEqual(result.body.rules, { aiMinSatisfaction: 7, maxRounds: 5 });
});

test('고른 규칙이 본문에 그대로 들어간다', () => {
  const result = validateConditions({ ...base, aiMinSatisfaction: 8, maxRounds: 3 });
  assert.ok(result.ok);
  assert.deepEqual(result.body.rules, { aiMinSatisfaction: 8, maxRounds: 3 });
});

test('범위 밖이거나 정수가 아닌 규칙은 오류', () => {
  for (const bad of [4, 11, 7.5, Number.NaN]) {
    const result = validateConditions({ ...base, aiMinSatisfaction: bad });
    assert.ok(!result.ok);
    assert.ok(result.errors.aiMinSatisfaction);
  }
  for (const bad of [0, 8, 2.5]) {
    const result = validateConditions({ ...base, maxRounds: bad });
    assert.ok(!result.ok);
    assert.ok(result.errors.maxRounds);
  }
});
