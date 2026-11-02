import test from 'node:test';
import assert from 'node:assert/strict';

import { validateConditions } from './conditions.ts';
import type { ConditionsInput } from './conditions.ts';

const base: ConditionsInput = {
  destination: '부산',
  startDate: '2026-11-07',
  endDate: '2026-11-08',
  budgetPerPerson: 300000,
  transport: '대중교통',
};

function body(input: Partial<ConditionsInput>) {
  const result = validateConditions({ ...base, ...input });
  assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
  return result.body;
}

function errors(input: Partial<ConditionsInput>) {
  const result = validateConditions({ ...base, ...input });
  assert.ok(!result.ok);
  return result.errors;
}

test('방장 칸(v2.4)을 비우면 본문에 싣지 않는다(예전 본문 그대로)', () => {
  const b = body({ arrivalTime: null, departureTime: null, bookedLodging: '  ', bookedPlaces: ['', ' '] });
  assert.deepEqual(Object.keys(b), ['destination', 'startDate', 'endDate', 'budgetPerPerson', 'transport', 'rules']);
});

test('방장 칸을 채우면 앞뒤 공백을 빼고 싣는다', () => {
  const b = body({ arrivalTime: '10:30', departureTime: '18:00', bookedLodging: ' 해운대 오션뷰 호텔 ', bookedPlaces: [' 부산 아쿠아리움', '', '블루라인파크'] });
  assert.equal(b.arrivalTime, '10:30');
  assert.equal(b.departureTime, '18:00');
  assert.equal(b.bookedLodging, '해운대 오션뷰 호텔');
  assert.deepEqual(b.bookedPlaces, ['부산 아쿠아리움', '블루라인파크']);
});

test('시각은 HH:MM(00:00–23:59)만', () => {
  assert.ok(errors({ arrivalTime: '24:00' }).arrivalTime);
  assert.ok(errors({ departureTime: '9:30' }).departureTime);
  assert.equal(body({ arrivalTime: '00:00', departureTime: '23:59' }).arrivalTime, '00:00');
});

test('당일치기는 도착이 출발보다 앞이어야 한다(1박 이상은 상관없음)', () => {
  const day = { startDate: '2026-11-07', endDate: '2026-11-07' };
  assert.equal(errors({ ...day, arrivalTime: '18:00', departureTime: '10:00' }).departureTime, '당일치기는 도착 시각이 출발 시각보다 앞이어야 해요.');
  assert.ok(errors({ ...day, arrivalTime: '10:00', departureTime: '10:00' }).departureTime);
  assert.equal(body({ ...day, arrivalTime: '10:00', departureTime: '18:00' }).departureTime, '18:00');
  assert.equal(body({ arrivalTime: '18:00', departureTime: '10:00' }).arrivalTime, '18:00');
});

test('예약한 숙소·장소 이름은 40자, 장소는 3곳까지', () => {
  assert.ok(errors({ bookedLodging: '가'.repeat(41) }).bookedLodging);
  assert.ok(errors({ bookedPlaces: ['가', '나', '다', '라'] }).bookedPlaces);
  assert.ok(errors({ bookedPlaces: ['가'.repeat(41)] }).bookedPlaces);
  assert.deepEqual(body({ bookedPlaces: ['가', '나', '다', ''] }).bookedPlaces, ['가', '나', '다']);
});
