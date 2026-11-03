import test from 'node:test';
import assert from 'node:assert/strict';

import type { InviteInfo } from '../persona/types.ts';
import { forgetPartyInfo, partyInfo, putPartyInfo } from './partyInfo.ts';

// 모양만 필요한 가짜 파티 정보(이 테스트는 내용이 같은지만 본다)
const info = (tripId: string, title: string) => ({ trip: { id: tripId, title }, members: [] }) as unknown as InviteInfo;

test('같은 파티 정보를 다시 받으면 저장소를 바꾸지 않고 구독자도 부르지 않는다', () => {
  const tripId = 'trp_same_test';
  putPartyInfo(info(tripId, '부산 1박 2일'));
  const before = partyInfo.get();
  let notified = 0;
  const off = partyInfo.subscribe(() => {
    notified += 1;
  });
  putPartyInfo(info(tripId, '부산 1박 2일'));
  assert.equal(partyInfo.get(), before);
  assert.equal(notified, 0);

  // 내용이 바뀌면 바꾸고 알린다.
  putPartyInfo(info(tripId, '부산 2박 3일'));
  assert.equal(notified, 1);
  assert.equal(partyInfo.get()[tripId]?.trip.title, '부산 2박 3일');

  off();
  forgetPartyInfo(tripId);
});

test('처음 받는 파티는 그대로 넣는다', () => {
  const tripId = 'trp_first_test';
  let notified = 0;
  const off = partyInfo.subscribe(() => {
    notified += 1;
  });
  putPartyInfo(info(tripId, '제주'));
  assert.equal(notified, 1);
  assert.equal(partyInfo.get()[tripId]?.trip.title, '제주');
  off();
  forgetPartyInfo(tripId);
});
