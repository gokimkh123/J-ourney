import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteParty } from './leaveParty.ts';
import type { DeletePartyDeps } from './leaveParty.ts';

function deps(fail?: Error) {
  const calls: string[] = [];
  const d: DeletePartyDeps = {
    async leaveTrip(tripId) {
      calls.push(`leave:${tripId}`);
    },
    async deleteTrip(tripId) {
      calls.push(`delete:${tripId}`);
      if (fail) throw fail;
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

test('방장 파티 없애기: 서버에서 없앤 뒤 이 폰에서도 뺀다(나가기는 부르지 않음)', async () => {
  const { d, calls } = deps();
  await deleteParty(d, 'trp_1');
  assert.deepEqual(calls, ['delete:trp_1', 'forget:trp_1', 'local:trp_1']);
});

test('서버가 막으면(회의 도는 중 409) 던지고 이 폰에서는 그대로 둔다', async () => {
  const { d, calls } = deps(new Error('409'));
  await assert.rejects(deleteParty(d, 'trp_1'), /409/);
  assert.deepEqual(calls, ['delete:trp_1']);
});
