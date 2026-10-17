import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore } from './session.ts';
import type { KeyValueStore, Session } from './session.ts';

function memoryKv(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

const me: Session = { token: 't', tripId: 'trp_1', inviteCode: 'BSN482', memberId: 'mem_01', nickname: '민수' };

test('save·clear·load마다 구독자를 부르고 해제하면 더 부르지 않는다', async () => {
  const store = createSessionStore(memoryKv());
  const seen: (Session | null)[] = [];
  const off = store.subscribe(() => seen.push(store.getSession()));

  await store.save(me);
  assert.deepEqual(seen, [me]);
  await store.clear();
  assert.deepEqual(seen, [me, null]);
  await store.load();
  assert.equal(seen.length, 3);

  off();
  await store.save(me);
  assert.equal(seen.length, 3);
});

test('구독자가 둘이어도 각각 한 번씩 부르고, 부르는 도중 해제해도 안전하다', async () => {
  const store = createSessionStore(memoryKv());
  let a = 0;
  let b = 0;
  const offA = store.subscribe(() => {
    a += 1;
    offA();
  });
  store.subscribe(() => {
    b += 1;
  });
  await store.save(me);
  await store.save(me);
  assert.equal(a, 1);
  assert.equal(b, 2);
});

test('clear는 저장소 삭제가 실패해도 메모리 세션부터 비운다', async () => {
  const kv = memoryKv();
  const store = createSessionStore({ ...kv, removeItem: async () => { throw new Error('boom'); } });
  await store.save(me);
  await assert.rejects(() => store.clear());
  assert.equal(store.getSession(), null);
});
