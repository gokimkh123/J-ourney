import test from 'node:test';
import assert from 'node:assert/strict';

import { validateConditions } from './conditions.ts';
import type { ConditionsInput } from './conditions.ts';

function input(over: Partial<ConditionsInput> = {}): ConditionsInput {
  return {
    destination: '부산',
    startDate: '2026-11-14',
    endDate: '2026-11-15',
    budgetPerPerson: '250,000',
    transport: '대중교통',
    ...over,
  };
}

function errorsOf(over: Partial<ConditionsInput>, today?: string): Record<string, string> {
  const result = validateConditions(input(over), today);
  assert.equal(result.ok, false);
  return result.ok ? {} : (result.errors as Record<string, string>);
}

function isOk(over: Partial<ConditionsInput>, today?: string): boolean {
  return validateConditions(input(over), today).ok;
}

test('정상 입력과 body 변환', () => {
  const result = validateConditions(input({ destination: '  부산  ', transport: ' 지하철 ', budgetPerPerson: ' 250,000 ' }));
  assert.deepEqual(result, {
    ok: true,
    body: {
      destination: '부산',
      startDate: '2026-11-14',
      endDate: '2026-11-15',
      budgetPerPerson: 250000,
      transport: '지하철',
      rules: { aiMinSatisfaction: 7, maxRounds: 5 },
    },
  });
});

test('destination·transport 길이 경계', () => {
  assert.equal(isOk({ destination: '가'.repeat(20) }), true);
  assert.deepEqual(Object.keys(errorsOf({ destination: '가'.repeat(21) })), ['destination']);
  assert.deepEqual(Object.keys(errorsOf({ destination: '   ' })), ['destination']);
  assert.equal(isOk({ destination: ` ${'가'.repeat(20)} ` }), true);
  assert.equal(isOk({ transport: 'a'.repeat(40) }), true);
  assert.deepEqual(Object.keys(errorsOf({ transport: 'a'.repeat(41) })), ['transport']);
  assert.deepEqual(Object.keys(errorsOf({ transport: '' })), ['transport']);
});

test('예산 경계와 형식', () => {
  for (const ok of ['10000', '10,000', '10000000', '10,000,000', 10000, 10000000]) {
    const result = validateConditions(input({ budgetPerPerson: ok }));
    assert.equal(result.ok, true, String(ok));
  }
  for (const bad of ['9999', '10000001', 9999, 10000001, 'abc', '1.5', '', '  ', ',', '-20000', '1만', 25000.5]) {
    assert.deepEqual(Object.keys(errorsOf({ budgetPerPerson: bad })), ['budgetPerPerson'], String(bad));
  }
  const body = validateConditions(input({ budgetPerPerson: 300000 }));
  assert.ok(body.ok && body.body.budgetPerPerson === 300000);
});

test('날짜 형식과 존재 여부', () => {
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-02-30', endDate: '2026-03-01' })), ['startDate']);
  assert.deepEqual(Object.keys(errorsOf({ endDate: '2026-11-1' })), ['endDate']);
  assert.deepEqual(Object.keys(errorsOf({ endDate: '2026/11/15' })), ['endDate']);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-13-01' })), ['startDate']);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-00-10' })), ['startDate']);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-04-31' })), ['startDate']);
});

test('윤년 처리', () => {
  assert.equal(isOk({ startDate: '2028-02-29', endDate: '2028-03-01' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2027-02-29', endDate: '2027-03-01' })), ['startDate']);
  assert.equal(isOk({ startDate: '2000-02-29', endDate: '2000-02-29' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '1900-02-29', endDate: '1900-03-01' })), ['startDate']);
  // 윤일을 낀 기간 계산: 2028-02-28 ~ 2028-03-05 는 6일 차이
  assert.equal(isOk({ startDate: '2028-02-28', endDate: '2028-03-05' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2028-02-28', endDate: '2028-03-06' })), ['endDate']);
  assert.equal(isOk({ startDate: '2027-02-28', endDate: '2027-03-06' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2027-02-28', endDate: '2027-03-07' })), ['endDate']);
});

test('endDate 순서와 기간 경계', () => {
  assert.equal(isOk({ startDate: '2026-11-14', endDate: '2026-11-14' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-11-14', endDate: '2026-11-13' })), ['endDate']);
  assert.equal(isOk({ startDate: '2026-11-14', endDate: '2026-11-20' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-11-14', endDate: '2026-11-21' })), ['endDate']);
  assert.equal(isOk({ startDate: '2026-12-28', endDate: '2027-01-03' }), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-12-28', endDate: '2027-01-04' })), ['endDate']);
});

test('잘못된 날짜 필드는 비교 검사를 건너뛴다', () => {
  const errors = errorsOf({ startDate: '2026-02-30', endDate: '2026-01-01' }, '2026-12-31');
  assert.deepEqual(Object.keys(errors), ['startDate']);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-11-14', endDate: 'zzz' })), ['endDate']);
});

test('today 유무', () => {
  assert.equal(isOk({ startDate: '2026-11-14', endDate: '2026-11-14' }, '2026-11-14'), true);
  assert.equal(isOk({ startDate: '2026-11-14', endDate: '2026-11-14' }, '2026-11-13'), true);
  assert.deepEqual(Object.keys(errorsOf({ startDate: '2026-11-14', endDate: '2026-11-15' }, '2026-11-15')), ['startDate']);
  assert.equal(isOk({ startDate: '2020-01-01', endDate: '2020-01-02' }), false === false);
  assert.equal(validateConditions(input({ startDate: '2020-01-01', endDate: '2020-01-02' })).ok, true);
  assert.equal(validateConditions(input({ startDate: '2020-01-01', endDate: '2020-01-02' }), '2020-01-02').ok, false);
});

test('여러 오류를 동시에 보고', () => {
  const errors = errorsOf({
    destination: '',
    startDate: 'x',
    endDate: '2026-02-30',
    budgetPerPerson: 'abc',
    transport: '',
  });
  assert.deepEqual(Object.keys(errors).sort(), ['budgetPerPerson', 'destination', 'endDate', 'startDate', 'transport']);
  for (const message of Object.values(errors)) assert.match(message, /[가-힣]/);
  const mixed = errorsOf({ destination: '가'.repeat(21), startDate: '2026-11-14', endDate: '2026-11-01', budgetPerPerson: 5 });
  assert.deepEqual(Object.keys(mixed).sort(), ['budgetPerPerson', 'destination', 'endDate']);
});
