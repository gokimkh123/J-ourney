import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeServerEvent } from './normalize.ts';
import { parseEvent } from './parse.ts';
import type { MeetingStartedEvent, ServerEvent } from './types.ts';

const started = (chips: unknown): ServerEvent =>
  ({
    type: 'meeting.started', tripId: 't', seq: 1, at: 'x',
    data: { meetingId: 'm', kind: 'meeting', maxRounds: 3, agents: [{ agentId: 'a', memberId: 'u', nickname: 'n', title: 't', color: '#fff', chips }] },
  }) as unknown as ServerEvent;

test('성향 칩이 글자 목록이면 {label, emoji}로 바꾼다', () => {
  const e = normalizeServerEvent(started(['느긋한', '맛집'])) as MeetingStartedEvent;
  assert.deepEqual(e.data.agents[0].chips, [{ label: '느긋한', emoji: '' }, { label: '맛집', emoji: '' }]);
});

test('이미 객체인 칩과 없는 칩', () => {
  const same = started([{ label: 'a', emoji: '😀' }]);
  assert.equal(normalizeServerEvent(same), same);
  const none = normalizeServerEvent(started(undefined)) as MeetingStartedEvent;
  assert.deepEqual(none.data.agents[0].chips, []);
});

test('좌표 없는 후보는 보드에서 빼고 안건 메모(placeId null)는 남긴다', () => {
  const event = {
    type: 'board.updated', tripId: 't', seq: 2, at: 'x',
    data: {
      candidates: [
        { placeId: 'p1', name: 'a', lat: 35.1, lng: 129, proposedBy: [], reactions: [] },
        { placeId: 'p2', name: 'b', lat: null, lng: null, proposedBy: [], reactions: [] },
      ],
      agenda: [{ placeId: null, text: '메모' }],
    },
  } as unknown as ServerEvent;
  const out = normalizeServerEvent(event);
  assert.equal(out.type === 'board.updated' && out.data.candidates.length, 1);
  assert.equal(out.type === 'board.updated' && out.data.agenda[0].placeId, null);
});

test('다른 이벤트는 그대로, 파서가 review 이벤트를 통과시킨다', () => {
  const plain = { type: 'agent.message', tripId: 't', seq: 3, at: 'x', data: { agentId: 'a', round: 0, text: 'hi' } } as ServerEvent;
  assert.equal(normalizeServerEvent(plain), plain);
  const parsed = parseEvent(JSON.stringify({ type: 'review.cast', tripId: 't', seq: 4, at: 'x', data: { meetingId: 'm', memberId: 'u', answered: 1, total: 3 } }));
  assert.equal(parsed?.type, 'review.cast');
  assert.equal(parseEvent(JSON.stringify({ type: 'review.unknown', seq: 5, data: {} })), null);
});
