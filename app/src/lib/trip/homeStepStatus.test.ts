import test from 'node:test';
import assert from 'node:assert/strict';

import { homeStep } from './homeStep.ts';

const ready = [
  { id: 'm1', personaReady: true },
  { id: 'm2', personaReady: true },
];

test('v2.4: 서버 여행이 meeting이면 이 폰에 조건이 없어도(방장 아님) 회의 단계', () => {
  const view = homeStep({ members: ready, myMemberId: 'm2', hasConditions: false, hasResult: false, tripStatus: 'meeting' });
  assert.equal(view.step, 'meeting');
  assert.equal(view.doneCount, 3);
});

test('v2.4: voting·confirmed도 회의를 지난 것으로 본다, 합의안이 있으면 result', () => {
  assert.equal(homeStep({ members: ready, myMemberId: 'm2', hasConditions: false, hasResult: false, tripStatus: 'voting' }).step, 'meeting');
  assert.equal(homeStep({ members: ready, myMemberId: 'm2', hasConditions: false, hasResult: true, tripStatus: 'confirmed' }).step, 'result');
});

test('preparing이거나 상태를 모르면 예전처럼 조건 단계', () => {
  assert.equal(homeStep({ members: ready, myMemberId: 'm2', hasConditions: false, hasResult: false, tripStatus: 'preparing' }).step, 'conditions');
  assert.equal(homeStep({ members: ready, myMemberId: 'm2', hasConditions: false, hasResult: false }).step, 'conditions');
});

test('서버가 meeting이어도 앞 단계(성향 검사·기다림)는 건너뛰지 않는다', () => {
  const waiting = [
    { id: 'm1', personaReady: true },
    { id: 'm2', personaReady: false },
  ];
  assert.equal(homeStep({ members: waiting, myMemberId: 'm2', hasConditions: false, hasResult: false, tripStatus: 'meeting' }).step, 'persona');
  assert.equal(homeStep({ members: waiting, myMemberId: 'm1', hasConditions: false, hasResult: false, tripStatus: 'meeting' }).step, 'waiting');
});
