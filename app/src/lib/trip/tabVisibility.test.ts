import test from 'node:test';
import assert from 'node:assert/strict';

import { tripTabs } from './tabVisibility.ts';

const base = { hasConditions: false, startedHere: false, hasResult: false, decided: false };

test('회의 준비 전: 회의·일정 탭 모두 숨김', () => {
  assert.deepEqual(tripTabs({ ...base, tripStatus: 'preparing' }), { meeting: false, plan: false });
  assert.deepEqual(tripTabs(base), { meeting: false, plan: false });
});

test('회의가 시작되면 회의 탭(서버 상태 meeting, 이 폰에서 시작, 조건 있음 중 하나)', () => {
  assert.deepEqual(tripTabs({ ...base, tripStatus: 'meeting' }), { meeting: true, plan: false });
  assert.deepEqual(tripTabs({ ...base, startedHere: true }), { meeting: true, plan: false });
  assert.deepEqual(tripTabs({ ...base, hasConditions: true }), { meeting: true, plan: false }, '가짜 서버: 조건으로 판단');
});

test('회의가 끝나면 일정 탭도(A·B 고르기는 회의 탭에서), A·B가 정해지면 회의 탭은 빠짐', () => {
  assert.deepEqual(tripTabs({ ...base, tripStatus: 'voting' }), { meeting: true, plan: true });
  assert.deepEqual(tripTabs({ ...base, hasConditions: true, hasResult: true }), { meeting: true, plan: true }, '가짜 서버: 합의안으로 판단');
  assert.deepEqual(tripTabs({ ...base, tripStatus: 'voting', decided: true }), { meeting: false, plan: true });
  assert.deepEqual(tripTabs({ ...base, tripStatus: 'confirmed', decided: true }), { meeting: false, plan: true });
});
