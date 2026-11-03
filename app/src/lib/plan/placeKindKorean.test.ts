import assert from 'node:assert/strict';
import { test } from 'node:test';

import { candidateRows } from '../meeting/view.ts';
import { initialMeetingState } from '../meeting/reducer.ts';
import type { MeetingState } from '../meeting/types.ts';
import { candidateKindOf, placeKindOf } from './placeKind.ts';

test('실서버 한글 분류도 스티커로 바뀐다(들어 있는 말로)', () => {
  assert.equal(placeKindOf('카페'), 'cafe');
  assert.equal(placeKindOf('한식'), 'food');
  assert.equal(placeKindOf('재래시장'), 'market');
  assert.equal(placeKindOf('해수욕장'), 'beach');
  assert.equal(placeKindOf('항구·포구'), 'beach');
  assert.equal(placeKindOf('해안절경'), 'beach', '바다가 볼거리보다 먼저');
  assert.equal(placeKindOf('전망대'), 'view');
  assert.equal(placeKindOf('사찰'), 'view');
  assert.equal(placeKindOf('문화마을'), 'view');
  assert.equal(placeKindOf('케이블카'), 'pin');
});

test('후보 종류: 숙소는 기본 핀, 음식점은 카페가 아니면 음식, 분류가 없으면 기본 핀', () => {
  assert.equal(candidateKindOf('lodging', '관광호텔'), 'pin');
  assert.equal(candidateKindOf('food', '한식'), 'food');
  assert.equal(candidateKindOf('food', '카페'), 'cafe');
  assert.equal(candidateKindOf('food', null), 'food');
  assert.equal(candidateKindOf('sight', '해수욕장'), 'beach');
  assert.equal(candidateKindOf(undefined, undefined), 'pin', '예전 서버');
});

test('candidateRows: 후보마다 장소 스티커 종류를 붙인다', () => {
  const state: MeetingState = {
    ...initialMeetingState(),
    board: {
      candidates: [
        { placeId: 'plc_1', name: '광안리', lat: 35, lng: 129, proposedBy: [], reactions: [], kind: 'sight', category: '해수욕장' },
        { placeId: 'plc_2', name: '모모스', lat: 35, lng: 129, proposedBy: [], reactions: [], kind: 'food', category: '카페' },
        { placeId: 'plc_3', name: '옛 후보', lat: 35, lng: 129, proposedBy: [], reactions: [] },
      ],
      agenda: [],
    },
  };
  assert.deepEqual(candidateRows(state).map((r) => r.kind), ['beach', 'cafe', 'pin']);
});
