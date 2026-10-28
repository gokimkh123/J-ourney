import test from 'node:test';
import assert from 'node:assert/strict';

import type { InviteInfo, Member, TripStatus } from '../persona/types.ts';
import { partyStatus } from './partyStatus.ts';

const member = (id: string, ready: boolean): Member => ({ id, nickname: id, color: '#000', isHost: false, personaReady: ready, title: null });
const info = (status: TripStatus, ready: boolean[]): InviteInfo => ({
  trip: { id: 'trp_1', title: '부산', inviteCode: 'BSN482', status },
  members: ready.map((r, i) => member(`mem_${i}`, r)),
});

test('정보가 없으면 null', () => {
  assert.equal(partyStatus(undefined), null);
});

test('준비 단계: 성향 검사를 안 한 사람이 있으면 몇 명 끝났는지, 모두 끝났으면 준비 완료', () => {
  assert.deepEqual(partyStatus(info('preparing', [true, false, true])), { label: '성향 기다리는 중 2/3', tone: 'warning' });
  assert.deepEqual(partyStatus(info('preparing', [true, true])), { label: '회의 준비 완료', tone: 'success' });
  assert.deepEqual(partyStatus(info('preparing', [])), { label: '회의 준비 완료', tone: 'success' });
});

test('회의·투표·확정 단계는 서버 상태를 그대로 말로 바꾼다', () => {
  assert.equal(partyStatus(info('meeting', [true]))!.label, 'AI 회의 중');
  assert.equal(partyStatus(info('voting', [true]))!.label, '확정 투표 중');
  assert.deepEqual(partyStatus(info('confirmed', [true])), { label: '일정 확정', tone: 'success' });
});
