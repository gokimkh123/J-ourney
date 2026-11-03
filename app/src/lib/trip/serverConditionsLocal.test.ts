import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConditionsBody } from './conditions.ts';
import { toServerConditions } from './serverConditions.ts';

const body: ConditionsBody = {
  destination: '부산',
  startDate: '2026-11-07',
  endDate: '2026-11-08',
  budgetPerPerson: 300000,
  transport: '대중교통',
  rules: { aiMinSatisfaction: 7, maxRounds: 5 },
  bookedPlaces: ['부산 아쿠아리움'],
  bookedPlaceTimes: [{ date: '2026-11-07', time: '14:00' }],
};

test('예약한 장소의 날짜·시각은 서버로 보내지 않고 이름만 보낸다', () => {
  const sent = toServerConditions(body);
  assert.equal('bookedPlaceTimes' in sent, false);
  assert.deepEqual(sent.bookedPlaces, ['부산 아쿠아리움']);
  assert.equal(sent.moveMode, 'transit');
});
