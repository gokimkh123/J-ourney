import test from 'node:test';
import assert from 'node:assert/strict';

import { toSession } from './session.ts';

const base = { token: 't', tripId: 'trp', inviteCode: 'ABC', memberId: 'm', nickname: 'n' };

test('시연 파티 표시(demo: true)는 읽어 두고, 없거나 다른 값이면 칸 자체를 만들지 않는다', () => {
  assert.deepEqual(toSession({ ...base, demo: true }), { ...base, demo: true });
  assert.deepEqual(toSession(base), base);
  assert.deepEqual(toSession({ ...base, demo: 'yes' }), base);
  assert.deepEqual(toSession({ ...base, demo: false }), base);
});
