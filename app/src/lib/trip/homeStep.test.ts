import assert from 'node:assert/strict';
import test from 'node:test';

import { homeStep } from './homeStep.ts';

const m = (id: string, personaReady: boolean) => ({ id, personaReady });

test('내 성향 검사가 먼저다(다른 사람이 다 준비돼도)', () => {
  const v = homeStep({ members: [m('a', false), m('b', true)], myMemberId: 'a', hasConditions: true, hasResult: true });
  assert.deepEqual(v, { step: 'persona', readyCount: 1, total: 2, doneCount: 0 });
});

test('나는 준비, 다른 사람이 남아 있으면 기다리기', () => {
  const v = homeStep({ members: [m('a', true), m('b', false), m('c', true)], myMemberId: 'a', hasConditions: false, hasResult: false });
  assert.deepEqual(v, { step: 'waiting', readyCount: 2, total: 3, doneCount: 1 });
});

test('모두 준비 → 조건 → 회의 → 결과 순서', () => {
  const all = [m('a', true), m('b', true)];
  const base = { members: all, myMemberId: 'a' };
  assert.equal(homeStep({ ...base, hasConditions: false, hasResult: false }).step, 'conditions');
  assert.equal(homeStep({ ...base, hasConditions: true, hasResult: false }).step, 'meeting');
  assert.equal(homeStep({ ...base, hasConditions: true, hasResult: true }).step, 'result');
  assert.equal(homeStep({ ...base, hasConditions: true, hasResult: true }).doneCount, 4);
});

test('조건 없이 결과만 남아 있으면 조건 단계(앞 단계를 건너뛰지 않음)', () => {
  const v = homeStep({ members: [m('a', true)], myMemberId: 'a', hasConditions: false, hasResult: true });
  assert.equal(v.step, 'conditions');
});

test('목록을 못 받았거나 내가 목록에 없으면 persona, 숫자는 0', () => {
  assert.deepEqual(homeStep({ members: null, myMemberId: 'a', hasConditions: false, hasResult: false }), {
    step: 'persona', readyCount: 0, total: 0, doneCount: 0,
  });
  assert.equal(homeStep({ members: [m('b', true)], myMemberId: 'a', hasConditions: true, hasResult: true }).step, 'persona');
});
