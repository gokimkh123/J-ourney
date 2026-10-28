import test from 'node:test';
import assert from 'node:assert/strict';

import type { ConditionsBody } from './conditions.ts';
import { moveModeOf, parseSavedConditions, toServerConditions } from './serverConditions.ts';

const body: ConditionsBody = {
  destination: '부산', startDate: '2026-11-10', endDate: '2026-11-12', budgetPerPerson: 300000,
  transport: '자동차', rules: { aiMinSatisfaction: 7, maxRounds: 5 },
};

test('이동 수단: 자동차만 car, 나머지는 transit', () => {
  assert.equal(moveModeOf('자동차'), 'car');
  assert.equal(moveModeOf('대중교통'), 'transit');
  assert.equal(moveModeOf('도보'), 'transit');
  assert.equal(moveModeOf(''), 'transit');
});

test('서버 조건: moveMode를 더하고 나머지는 그대로', () => {
  const s = toServerConditions(body);
  assert.equal(s.moveMode, 'car');
  assert.equal(s.destination, '부산');
  assert.equal(s.budgetPerPerson, 300000);
  assert.deepEqual(s.rules, { aiMinSatisfaction: 7, maxRounds: 5 });
});

test('라운드 수는 서버 상한 5로 맞춘다(원본은 안 바뀐다)', () => {
  const s = toServerConditions({ ...body, rules: { aiMinSatisfaction: 8, maxRounds: 7 } });
  assert.equal(s.rules.maxRounds, 5);
  assert.equal(s.rules.aiMinSatisfaction, 8);
  assert.equal(body.rules.maxRounds, 5);
});

test('저장 응답에서 지역 코드와 이름을 읽는다', () => {
  assert.deepEqual(parseSavedConditions({ conditions: {}, destination: { regionCode: '2600000000', label: '부산광역시' } }), {
    regionCode: '2600000000', label: '부산광역시',
  });
  assert.throws(() => parseSavedConditions({}));
});
