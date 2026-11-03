import test from 'node:test';
import assert from 'node:assert/strict';

import { decidedTrips, noteBoardStatus } from '../plan/decidedStore.ts';
import { atSpeed, meetingSpeed } from './speedStore.ts';

test('2배속이면 쉬는 시간이 반, 늦추지 않는 이벤트(0)는 그대로', () => {
  assert.equal(atSpeed(1200, 1), 1200);
  assert.equal(atSpeed(1200, 2), 600);
  assert.equal(atSpeed(0, 2), 0);
  meetingSpeed.set(2);
  assert.equal(atSpeed(800), 400, '지금 빠르기를 따른다');
  meetingSpeed.set(1);
  assert.equal(atSpeed(800), 800);
});

test('A·B가 정해지면(고르기 다음 단계) 그 여행을 정해진 것으로 적고, 고르는 중이면 적지 않는다', () => {
  decidedTrips.set({});
  noteBoardStatus('trp_1', 'choosing');
  assert.deepEqual(decidedTrips.get(), {});
  noteBoardStatus('trp_1', 'revising');
  noteBoardStatus('trp_2', 'confirmed');
  assert.deepEqual(decidedTrips.get(), { trp_1: true, trp_2: true });
  // 한 번 들면 다시 고르는 중이 와도 빼지 않는다(같은 여행에서 회의를 다시 못 함)
  noteBoardStatus('trp_1', 'choosing');
  assert.equal(decidedTrips.get().trp_1, true);
});
