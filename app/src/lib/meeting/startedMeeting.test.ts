import assert from 'node:assert/strict';
import test from 'node:test';

import { initialMeetingState } from './reducer.ts';
import { onlyMeeting, rememberStartedMeeting, startedMeetingStore } from './startedMeeting.ts';
import type { MeetingState } from './types.ts';

const old: MeetingState = { ...initialMeetingState(), meetingId: 'm1', phase: 'proposed', lastSeq: 40 };

test('시작한 회의가 아닌 옛 회의는 빈 상태로 가린다', () => {
  const shown = onlyMeeting(old, 'm2');
  assert.equal(shown.meetingId, null);
  assert.equal(shown.phase, 'idle');
  assert.equal(shown.lastSeq, 40);
});

test('시작한 회의와 같은 번호면 그대로 보여 준다', () => {
  assert.equal(onlyMeeting(old, 'm1'), old);
});

test('이 폰에서 시작하지 않았으면(번호 없음) 그대로 둔다', () => {
  assert.equal(onlyMeeting(old, null), old);
});

test('회의가 아직 없는 빈 상태는 그대로 둔다', () => {
  const empty = initialMeetingState();
  assert.equal(onlyMeeting(empty, 'm2'), empty);
});

test('여행별로 시작한 회의 번호를 기억하고 새로 시작하면 바꾼다', () => {
  startedMeetingStore.set({});
  rememberStartedMeeting('t1', 'm1');
  rememberStartedMeeting('t2', 'mA');
  rememberStartedMeeting('t1', 'm2');
  assert.deepEqual(startedMeetingStore.get(), { t1: 'm2', t2: 'mA' });
});
