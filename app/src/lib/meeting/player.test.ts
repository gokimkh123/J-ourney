import test from 'node:test';
import assert from 'node:assert/strict';

import { planPlayback } from './player.ts';
import type { MeetingEvent } from './types.ts';

function makeEvent(seq: number): MeetingEvent {
  return {
    type: 'round.started',
    tripId: 'trp_8f3k2',
    seq,
    at: '2026-10-24T14:03:11+09:00',
    data: { round: seq, maxRounds: 3 },
  };
}

test('planPlayback: 뒤섞인 seq를 오름차순으로 정렬', () => {
  const plan = planPlayback([makeEvent(3), makeEvent(1), makeEvent(2)], { intervalMs: 100 });
  assert.deepEqual(
    plan.map((p) => p.event.seq),
    [1, 2, 3],
  );
});

test('planPlayback: delayMs는 누적 시간', () => {
  const plan = planPlayback([makeEvent(2), makeEvent(1), makeEvent(3)], { intervalMs: 250 });
  assert.deepEqual(
    plan.map((p) => p.delayMs),
    [0, 250, 500],
  );
});

test('planPlayback: 빈 배열은 빈 배열', () => {
  assert.deepEqual(planPlayback([], { intervalMs: 100 }), []);
});

test('planPlayback: 입력 배열을 변경하지 않음', () => {
  const input = [makeEvent(3), makeEvent(1), makeEvent(2)];
  const snapshot = [...input];
  const plan = planPlayback(input, { intervalMs: 100 });
  assert.deepEqual(
    input.map((e) => e.seq),
    [3, 1, 2],
  );
  assert.equal(input[0], snapshot[0]);
  assert.equal(input.length, 3);
  assert.notEqual(plan.length, 0);
});

test('planPlayback: intervalMs 0이면 모두 delayMs 0', () => {
  const plan = planPlayback([makeEvent(2), makeEvent(1)], { intervalMs: 0 });
  assert.deepEqual(
    plan.map((p) => p.delayMs),
    [0, 0],
  );
  assert.deepEqual(
    plan.map((p) => p.event.seq),
    [1, 2],
  );
});
