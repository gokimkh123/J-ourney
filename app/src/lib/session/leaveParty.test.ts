import test from 'node:test';
import assert from 'node:assert/strict';

import { dropDeletedParty, leaveParty } from './leaveParty.ts';
import type { LeavePartyDeps } from './leaveParty.ts';

function deps(serverFails = false) {
  const calls: string[] = [];
  const d: LeavePartyDeps = {
    async leaveTrip(tripId) {
      calls.push(`server:${tripId}`);
      if (serverFails) throw new Error('409');
    },
    forgetInfo(tripId) {
      calls.push(`forget:${tripId}`);
    },
    async leaveLocal(tripId) {
      calls.push(`local:${tripId}`);
    },
  };
  return { d, calls };
}

test('파티원 나가기: 서버에서 나간 뒤 이 폰에서도 뺀다', async () => {
  const { d, calls } = deps();
  await leaveParty(d, 'trp_1', false);
  assert.deepEqual(calls, ['server:trp_1', 'forget:trp_1', 'local:trp_1']);
});

test('방장 나가기: 서버는 부르지 않고(403) 이 폰에서만 뺀다', async () => {
  const { d, calls } = deps();
  await leaveParty(d, 'trp_1', true);
  assert.deepEqual(calls, ['forget:trp_1', 'local:trp_1']);
});

test('서버가 막아도(회의 시작 뒤 409·연결 실패) 이 폰에서는 뺀다', async () => {
  const { d, calls } = deps(true);
  await leaveParty(d, 'trp_1', false);
  assert.deepEqual(calls, ['server:trp_1', 'forget:trp_1', 'local:trp_1']);
});

test('없어진 파티: 서버에 묻지 않고 이 폰에서만 뺀다', async () => {
  const { d, calls } = deps();
  await dropDeletedParty(d, 'trp_9');
  assert.deepEqual(calls, ['forget:trp_9', 'local:trp_9']);
});
