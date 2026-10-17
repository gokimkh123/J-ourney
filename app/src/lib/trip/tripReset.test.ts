import assert from 'node:assert/strict';
import test from 'node:test';

import { watchTripChange } from './tripReset.ts';

function fakeSession(initial: string | null) {
  let current = initial === null ? null : { tripId: initial };
  const listeners = new Set<() => void>();
  return {
    getSession: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(tripId: string | null) {
      current = tripId === null ? null : { tripId };
      for (const l of [...listeners]) l();
    },
  };
}

test('나가기·다른 여행 참여에서만 부르고, 같은 여행 저장은 무시한다', () => {
  const s = fakeSession('trp_A');
  let calls = 0;
  watchTripChange(s, () => (calls += 1));
  s.set('trp_A');
  assert.equal(calls, 0);
  s.set(null);
  assert.equal(calls, 1);
  s.set(null);
  assert.equal(calls, 1);
  s.set('trp_B');
  assert.equal(calls, 2);
  s.set('trp_C');
  assert.equal(calls, 3);
});

test('해제하면 더 부르지 않는다', () => {
  const s = fakeSession(null);
  let calls = 0;
  const off = watchTripChange(s, () => (calls += 1));
  s.set('trp_A');
  off();
  s.set(null);
  assert.equal(calls, 1);
});
