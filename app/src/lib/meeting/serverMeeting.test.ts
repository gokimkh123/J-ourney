import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api/errors.ts';
import { parseEvents, parseMeeting, parseMeetingStart } from './serverMeeting.ts';

const base = {
  id: 'm1', tripId: 't1', runNo: 1, status: 'researching', llmCalls: 0,
  startedAt: '2026-11-01T00:00:00Z', finishedAt: null, review: null,
};

test('회의 시작 응답(202)을 읽는다', () => {
  assert.deepEqual(parseMeetingStart({ meeting: { id: 'm1', status: 'researching' } }), {
    id: 'm1', status: 'researching', maxRounds: null,
  });
  assert.equal(parseMeetingStart({ meeting: { id: 'm1', status: 'researching', maxRounds: 3 } }).maxRounds, 3);
  assert.throws(() => parseMeetingStart({ meeting: { id: 'm1', status: 'done' } }), ApiError);
  assert.throws(() => parseMeetingStart({}), ApiError);
});

test('조사 중인 회의: review는 null', () => {
  const m = parseMeeting({ meeting: base });
  assert.equal(m.status, 'researching');
  assert.equal(m.review, null);
  assert.equal(m.finishedAt, null);
});

test('사람 확인 중인 회의: 안건·내 선택·마감 결과를 읽는다', () => {
  const m = parseMeeting({
    meeting: {
      ...base, status: 'reviewing',
      review: {
        items: [{ placeId: 'p1', name: '해운대', text: '넣을까요?', consequence: null }],
        memos: ['메모'], total: 3, responded: ['u1'],
        mine: [{ placeId: 'p1', keep: true }],
        decision: {
          kept: ['p1'], dropped: [], responded: ['u1'], defaulted: ['u2'], closedBy: 'host',
          votes: [{ placeId: 'p1', keep: 1, drop: 0, kept: true, tie: false }],
        },
      },
    },
  });
  assert.equal(m.review?.items[0].name, '해운대');
  assert.equal(m.review?.items[0].consequence, null);
  assert.deepEqual(m.review?.mine, [{ placeId: 'p1', keep: true }]);
  assert.equal(m.review?.decision?.closedBy, 'host');
  assert.equal(m.review?.decision?.votes[0].kept, true);
});

test('내가 아직 안 냈으면 mine은 null', () => {
  const m = parseMeeting({
    meeting: { ...base, status: 'reviewing', review: { items: [], memos: [], total: 2, responded: [], mine: null, decision: null } },
  });
  assert.equal(m.review?.mine, null);
  assert.equal(m.review?.decision, null);
});

test('모르는 상태나 깨진 모양은 BAD_RESPONSE', () => {
  assert.throws(() => parseMeeting({ meeting: { ...base, status: 'weird' } }), (e: unknown) => e instanceof ApiError && e.code === 'BAD_RESPONSE');
  assert.throws(() => parseMeeting({ meeting: { ...base, runNo: 'x' } }), ApiError);
  assert.throws(() => parseMeeting(null), ApiError);
  assert.throws(() => parseMeeting({ meeting: { ...base, status: 'reviewing', review: { items: 'x' } } }), ApiError);
});

test('이벤트 목록: 모르는 종류와 ping은 건너뛴다', () => {
  const events = parseEvents({
    events: [
      { seq: 1, type: 'meeting.started', data: {} },
      { seq: 2, type: 'something.new', data: {} },
      { seq: 3, type: 'ping', data: {} },
      'garbage',
    ],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].seq, 1);
  assert.throws(() => parseEvents({}), ApiError);
});
