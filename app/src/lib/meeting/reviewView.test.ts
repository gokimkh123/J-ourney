import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEvent, initialMeetingState } from './reducer.ts';
import {
  answeredLabel, autoChoices, canSend, demoAnswers, hasAnswered, itemNumber, pendingNames,
  pickedCountLabel, remainingCount, reviewPeople, reviewPins, sendLabel, toChoices,
} from './reviewView.ts';
import type { Board, MeetingState, ReviewItemData, ServerEvent } from './types.ts';

const items: ReviewItemData[] = [
  { placeId: 'p1', name: '블루라인파크', text: 'a', consequence: null },
  { placeId: 'p2', name: '자갈치시장', text: 'b', consequence: null },
];
const ev = (seq: number, type: string, data: unknown) => ({ type, tripId: 't', seq, at: 'x', data }) as unknown as ServerEvent;
const agent = (n: string) => ({ agentId: `agt_${n}`, memberId: `mem_${n}`, nickname: n, title: '', chips: [], color: '#000' });

function reviewing(): MeetingState {
  let s = initialMeetingState();
  for (const e of [
    ev(1, 'meeting.started', { meetingId: 'm', kind: 'meeting', maxRounds: 3, agents: [agent('a'), agent('b'), agent('c'), agent('d')] }),
    ev(2, 'review.requested', { meetingId: 'm', items, memos: [], total: 4 }),
  ]) s = applyEvent(s, e).state;
  return s;
}

test('안건을 다 골라야 보낼 수 있고 버튼 글자가 남은 개수를 알려 준다', () => {
  assert.equal(canSend(items, {}), false);
  assert.equal(sendLabel(items, {}), '2개 더 골라 주세요');
  assert.equal(sendLabel(items, { p1: true }), '1개 더 골라 주세요');
  assert.equal(remainingCount(items, { p1: false }), 1);
  assert.equal(pickedCountLabel(items, { p1: false }), '1/2');
  assert.equal(canSend(items, { p1: true, p2: false }), true);
  assert.equal(sendLabel(items, { p1: true, p2: false }), '내 선택 보내기');
  assert.equal(canSend([], {}), false);
});

test('서버로 보낼 모양: 안건 순서대로, 덜 골랐으면 null', () => {
  assert.equal(toChoices(items, { p1: true }), null);
  assert.deepEqual(toChoices(items, { p2: false, p1: true }), [
    { placeId: 'p1', keep: true },
    { placeId: 'p2', keep: false },
  ]);
});

const board: Board = {
  candidates: [
    { placeId: 'p1', name: 'x', lat: 1, lng: 1, proposedBy: [], reactions: [{ agentId: 'agt_b', kind: 'warn', reason: '' }, { agentId: 'agt_c', kind: 'like', reason: '' }] },
    { placeId: 'p2', name: 'y', lat: 1, lng: 1, proposedBy: [], reactions: [{ agentId: 'agt_c', kind: 'block', reason: '' }] },
  ],
  agenda: [],
};

test('시연 자동 답: 조심·반대를 단 곳은 빼고, 나머지·보드에 없는 곳은 넣는다', () => {
  assert.deepEqual(autoChoices(items, board, 'agt_b'), [{ placeId: 'p1', keep: false }, { placeId: 'p2', keep: true }]);
  assert.deepEqual(autoChoices(items, board, 'agt_c'), [{ placeId: 'p1', keep: true }, { placeId: 'p2', keep: false }]);
  assert.deepEqual(autoChoices([{ ...items[0], placeId: 'zz' }], board, 'agt_b'), [{ placeId: 'zz', keep: true }]);
});

test('시연 자동 답은 방장을 뺀 구성원 몫만 만든다', () => {
  const s = { ...reviewing(), board };
  const out = demoAnswers(s, 'mem_a');
  assert.deepEqual(out.map((o) => o.memberId), ['mem_b', 'mem_c', 'mem_d']);
  assert.equal(out[0].choices.length, 2);
  assert.deepEqual(demoAnswers(initialMeetingState(), 'mem_a'), []);
});

test('응답 현황: 사람별 답함과 N/M, 같은 사람이 다시 내도 한 번만', () => {
  let s = reviewing();
  assert.deepEqual(answeredLabel(s), { short: '0/4', spoken: '4명 중 0명 답했어요' });
  s = applyEvent(s, ev(3, 'review.cast', { meetingId: 'm', memberId: 'mem_a', answered: 1, total: 4 })).state;
  s = applyEvent(s, ev(4, 'review.cast', { meetingId: 'm', memberId: 'mem_a', answered: 1, total: 4 })).state;
  s = applyEvent(s, ev(5, 'review.cast', { meetingId: 'm', memberId: 'mem_b', answered: 2, total: 4 })).state;
  assert.deepEqual(s.review?.answeredBy, ['mem_a', 'mem_b']);
  assert.equal(answeredLabel(s).short, '2/4');
  assert.deepEqual(reviewPeople(s).map((p) => p.answered), [true, true, false, false]);
  assert.deepEqual(pendingNames(s), ['c', 'd']);
  assert.equal(hasAnswered(s, 'mem_a'), true);
  assert.equal(hasAnswered(s, 'mem_c'), false);
});

test('안건 번호는 1부터, 없으면 0', () => {
  assert.equal(itemNumber(items, 'p1'), 1);
  assert.equal(itemNumber(items, 'p2'), 2);
  assert.equal(itemNumber(items, 'nope'), 0);
});

test('지도 핀: 확인할 안건의 핀에만 안건 번호를 단다', () => {
  const pins = [{ id: 'p2' }, { id: 'zz' }, { id: 'p1', label: '9' }];
  assert.deepEqual(reviewPins(pins, items), [{ id: 'p2', label: '2' }, { id: 'zz' }, { id: 'p1', label: '1' }]);
});
