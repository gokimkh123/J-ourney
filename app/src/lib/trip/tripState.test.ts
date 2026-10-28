import test from 'node:test';
import assert from 'node:assert/strict';

import { createValueStore } from '../store/valueStore.ts';
import { keepPerTrip } from './tripState.ts';

function fakeSession(initial: string | null) {
  let tripId = initial;
  const listeners = new Set<() => void>();
  return {
    getSession: () => (tripId === null ? null : { tripId }),
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    go(next: string | null) {
      tripId = next;
      for (const l of [...listeners]) l();
    },
  };
}

test('파티를 오가도 각 파티의 값이 섞이지 않고 돌아오면 되살아난다', () => {
  const session = fakeSession('A');
  const cond = createValueStore<string | null>('조건A');
  const result = createValueStore<number | null>(1);
  keepPerTrip(session, [cond, result]);

  session.go('B');
  assert.equal(cond.get(), null);
  assert.equal(result.get(), null);
  cond.set('조건B');

  session.go('A');
  assert.equal(cond.get(), '조건A');
  assert.equal(result.get(), 1);

  session.go('B');
  assert.equal(cond.get(), '조건B');
  assert.equal(result.get(), null);
});

test('초기 화면(파티 없음)에서는 비고, 같은 파티로 다시 알려도 건드리지 않는다', () => {
  const session = fakeSession('A');
  const cond = createValueStore<string | null>('조건A');
  keepPerTrip(session, [cond]);

  session.go('A');
  assert.equal(cond.get(), '조건A');

  session.go(null);
  assert.equal(cond.get(), null);
  session.go('A');
  assert.equal(cond.get(), '조건A');
});

test('해제하면 더 이상 바꾸지 않는다', () => {
  const session = fakeSession('A');
  const cond = createValueStore<string | null>('조건A');
  const off = keepPerTrip(session, [cond]);
  off();
  session.go('B');
  assert.equal(cond.get(), '조건A');
});
