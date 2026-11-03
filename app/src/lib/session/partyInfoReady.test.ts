import test from 'node:test';
import assert from 'node:assert/strict';

import type { InviteInfo } from '../persona/types.ts';
import { forgetPartyInfo, markPersonaReady, partyInfo, putPartyInfo } from './partyInfo.ts';

// 준비 표시만 보는 가짜 파티 정보
const member = (id: string, personaReady: boolean) => ({ id, nickname: id, color: '#000000', isHost: id === 'm1', personaReady });
const info = (tripId: string, members: ReturnType<typeof member>[]) => ({ trip: { id: tripId, title: '부산' }, members }) as unknown as InviteInfo;

test('성향 검사를 막 내면 받아 둔 정보에서 내 준비 표시만 바로 켠다(회의 시작하기가 바로 뜨게)', () => {
  const tripId = 'trp_ready_mark';
  putPartyInfo(info(tripId, [member('m1', false), member('m2', true), member('m3', false)]));
  markPersonaReady(tripId, 'm1');
  assert.deepEqual(
    (partyInfo.get()[tripId]?.members ?? []).map((m) => [m.id, m.personaReady]),
    [
      ['m1', true],
      ['m2', true],
      ['m3', false],
    ],
  );
  forgetPartyInfo(tripId);
});

test('이미 준비됐거나 받아 둔 정보·구성원이 없으면 저장소를 건드리지 않는다', () => {
  const tripId = 'trp_ready_same';
  putPartyInfo(info(tripId, [member('m1', true)]));
  const before = partyInfo.get();
  let notified = 0;
  const off = partyInfo.subscribe(() => {
    notified += 1;
  });
  markPersonaReady(tripId, 'm1');
  markPersonaReady(tripId, 'm9');
  markPersonaReady('trp_ready_none', 'm1');
  assert.equal(partyInfo.get(), before);
  assert.equal(notified, 0);
  off();
  forgetPartyInfo(tripId);
});
