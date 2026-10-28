import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEvent, initialMeetingState } from './reducer.ts';
import type { MeetingState, ServerEvent } from './types.ts';

function run(events: ServerEvent[]): MeetingState {
  let state = initialMeetingState();
  for (const e of events) {
    const r = applyEvent(state, e);
    assert.equal(r.gap, false);
    state = r.state;
  }
  return state;
}
const ev = (seq: number, type: string, data: unknown) => ({ type, tripId: 't', seq, at: 'x', data }) as unknown as ServerEvent;

const started = ev(1, 'meeting.started', { meetingId: 'm1', kind: 'meeting', maxRounds: 3, agents: [] });
const requested = ev(2, 'review.requested', {
  meetingId: 'm1', total: 3, memos: ['메모'],
  items: [{ placeId: 'p1', name: '해운대', text: '넣을까요?', consequence: null }],
});
const decision = { meetingId: 'm1', kept: ['p1'], dropped: [], votes: [], responded: ['u1'], defaulted: ['u2'], closedBy: 'host' };
const proposed = ev(5, 'plan.proposed', { planId: 'pa', version: 1, label: 'A', moveMode: 'transit', lodging: null, route: [], notes: ['안내'] });

test('사람 확인 요청이 오면 reviewing, 응답 수가 늘어난다', () => {
  const s = run([started, requested, ev(3, 'review.cast', { meetingId: 'm1', memberId: 'u1', answered: 1, total: 3 })]);
  assert.equal(s.phase, 'reviewing');
  assert.equal(s.review?.answered, 1);
  assert.equal(s.review?.total, 3);
  assert.equal(s.review?.items[0].name, '해운대');
  assert.equal(s.review?.decision, null);
});

test('마감되면 결과를 담고 동선 짜는 중(researching)으로 돌아간다', () => {
  const s = run([started, requested, ev(3, 'review.closed', decision)]);
  assert.equal(s.phase, 'researching');
  assert.deepEqual(s.review?.decision?.kept, ['p1']);
  assert.equal(s.review?.decision?.closedBy, 'host');
});

test('합의 없이 A·B 안이 오면 proposed, 라벨과 안내가 남는다', () => {
  const s = run([started, requested, ev(3, 'review.closed', decision), ev(4, 'plan.proposed', { planId: 'pb', version: 1, label: 'B', route: [] }), proposed]);
  assert.equal(s.phase, 'proposed');
  assert.equal(s.plans.pa.label, 'A');
  assert.deepEqual(s.plans.pa.notes, ['안내']);
  assert.equal(s.plans.pb.label, 'B');
  assert.equal(s.latestPlanId, 'pa');
});

test('새 회의가 시작되면 지난 사람 확인은 지워진다', () => {
  const s = run([started, requested, ev(3, 'meeting.started', { meetingId: 'm2', kind: 'meeting', maxRounds: 3, agents: [] })]);
  assert.equal(s.review, null);
});

test('이어지지 않는 seq는 gap, review.cast가 요청 없이 오면 무시', () => {
  const r = applyEvent(initialMeetingState(), requested);
  assert.equal(r.gap, true);
  const s = run([ev(1, 'review.cast', { meetingId: 'm1', memberId: 'u', answered: 1, total: 2 })]);
  assert.equal(s.review, null);
});
