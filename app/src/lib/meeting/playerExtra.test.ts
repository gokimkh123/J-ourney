import test from 'node:test';
import assert from 'node:assert/strict';

import { eventDelayMs, eventsUntilFirstAgreed } from './player.ts';
import { MEETING_EVENT_TYPES } from './types.ts';
import type { MeetingEvent, MeetingEventType } from './types.ts';
import { busanEvents } from './fixtures/busan.ts';

const EXPECTED: Record<MeetingEventType, number> = {
  'meeting.started': 800,
  'research.progress': 700,
  'board.updated': 1000,
  'round.started': 800,
  'agent.message': 1600,
  'place.checked': 500,
  'plan.proposed': 1200,
  'vote.cast': 600,
  'meeting.agreed': 1000,
  'meeting.failed': 1000,
  'confirm.requested': 800,
  'confirm.cast': 600,
  'plan.confirmed': 800,
};

function sample(type: MeetingEventType): MeetingEvent {
  return { type, tripId: 't', seq: 1, at: 'x', data: {} } as unknown as MeetingEvent;
}

test('eventDelayMs: 모든 종류가 양수이고 표와 같다', () => {
  for (const type of MEETING_EVENT_TYPES) {
    const ms = eventDelayMs(sample(type));
    assert.ok(ms > 0);
    assert.equal(ms, EXPECTED[type]);
  }
});

test('eventsUntilFirstAgreed: 마지막이 첫 meeting.agreed', () => {
  const result = eventsUntilFirstAgreed(busanEvents);
  const last = result[result.length - 1];
  assert.equal(last?.type, 'meeting.agreed');
  const firstAgreed = busanEvents.find((e) => e.type === 'meeting.agreed');
  assert.equal(last, firstAgreed);
  assert.equal(result.length, busanEvents.indexOf(firstAgreed!) + 1);
  assert.equal(result.filter((e) => e.type === 'meeting.agreed').length, 1);
});

test('eventsUntilFirstAgreed: 뒤섞은 입력도 seq 순서로 잘림', () => {
  const shuffled = [...busanEvents].reverse();
  const result = eventsUntilFirstAgreed(shuffled);
  assert.deepEqual(result, eventsUntilFirstAgreed(busanEvents));
  assert.deepEqual(
    result.map((e) => e.seq),
    result.map((_, i) => i + 1),
  );
});

test('eventsUntilFirstAgreed: meeting.agreed가 없으면 정렬된 전부', () => {
  const noAgreed = busanEvents.filter((e) => e.type !== 'meeting.agreed').reverse();
  const result = eventsUntilFirstAgreed(noAgreed);
  assert.equal(result.length, noAgreed.length);
  assert.deepEqual(
    result.map((e) => e.seq),
    [...noAgreed.map((e) => e.seq)].sort((a, b) => a - b),
  );
  assert.deepEqual(eventsUntilFirstAgreed([]), []);
});

test('eventsUntilFirstAgreed: 입력 배열을 바꾸지 않음', () => {
  const input = [...busanEvents].reverse();
  const snapshot = [...input];
  eventsUntilFirstAgreed(input);
  assert.equal(input.length, snapshot.length);
  input.forEach((e, i) => assert.equal(e, snapshot[i]));
});
