import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore } from './session.ts';
import type { KeyValueStore, Session } from './session.ts';

const a: Session = { token: 'tok_a', tripId: 'trp_a', inviteCode: 'AAA111', memberId: 'mem_a', nickname: '민수' };
const b: Session = { token: 'tok_b', tripId: 'trp_b', inviteCode: 'BBB222', memberId: 'mem_b', nickname: '민수' };

// 쓰기를 부른 순서대로 끝내는 저장소(AsyncStorage처럼). flush()를 불러야 쌓인 쓰기가 끝난다.
function slowStore(): { kv: KeyValueStore; flush(): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  const pending: (() => void)[] = [];
  const later = (apply: () => void) =>
    new Promise<void>((resolve) => {
      pending.push(() => {
        apply();
        resolve();
      });
    });
  return {
    kv: {
      getItem: async (key) => data.get(key) ?? null,
      setItem: (key, value) => later(() => data.set(key, value)),
      removeItem: (key) => later(() => data.delete(key)),
    },
    flush() {
      while (pending.length > 0) pending.shift()!();
    },
    data,
  };
}

test('저장이 끝나기 전에 나가도(clear) 늦게 끝난 저장이 세션을 되살리지 않는다', async () => {
  const { kv, flush, data } = slowStore();
  const store = createSessionStore(kv);
  const saving = store.save(a);
  const clearing = store.clear();
  flush();
  await Promise.all([saving, clearing]);
  assert.equal(store.getSession(), null);
  assert.equal(data.size, 0);
});

test('저장이 끝나기 전에 다른 파티를 저장하면 마지막에 부른 것이 남는다', async () => {
  const { kv, flush, data } = slowStore();
  const store = createSessionStore(kv);
  const first = store.save(a);
  const second = store.save(b);
  flush();
  await Promise.all([first, second]);
  assert.deepEqual(store.getSession(), b);
  assert.deepEqual([...data.values()].map((raw) => JSON.parse(raw)), [b]);
});

test('저장을 부르면 끝나기를 기다리지 않고 바로 세션이 바뀌고 알린다', async () => {
  const { kv, flush } = slowStore();
  const store = createSessionStore(kv);
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  const saving = store.save(a);
  assert.deepEqual(store.getSession(), a);
  assert.equal(notified, 1);
  flush();
  await saving;
});
