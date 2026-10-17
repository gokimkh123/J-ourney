import test from 'node:test';
import assert from 'node:assert/strict';

import { createValueStore } from './valueStore.ts';

test('값을 바꾸면 구독자를 부르고 해제하면 부르지 않는다', () => {
  const store = createValueStore<number | null>(null);
  const seen: (number | null)[] = [];
  const off = store.subscribe(() => seen.push(store.get()));
  store.set(1);
  store.set(null);
  off();
  store.set(2);
  assert.deepEqual(seen, [1, null]);
  assert.equal(store.get(), 2);
});

test('부르는 도중 다른 구독자를 해제해도 안전하다', () => {
  const store = createValueStore(0);
  const seen: string[] = [];
  const offA = store.subscribe(() => {
    seen.push('a');
    offB();
  });
  const offB = store.subscribe(() => seen.push('b'));
  void offA;
  store.set(1);
  assert.deepEqual(seen, ['a']);
});
