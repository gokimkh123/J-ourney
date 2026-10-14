import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore, fromSessionResponse } from './session.ts';
import type { KeyValueStore, Session } from './session.ts';
import type { SessionResponse } from '../persona/types.ts';

const KEY = 'journey.session.v1';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

const session: Session = {
  token: 'tok_1',
  tripId: 'trp_1',
  inviteCode: 'BSN482',
  memberId: 'mem_01',
  nickname: '민수',
};

test('저장 후 새 store로 복원', async () => {
  const kv = memoryStore();
  const first = createSessionStore(kv);
  await first.save(session);
  assert.deepEqual(JSON.parse(kv.data.get(KEY) ?? ''), session);

  const second = createSessionStore(kv);
  assert.deepEqual(await second.load(), session);
  assert.deepEqual(second.getSession(), session);
});

test('저장값이 없으면 load는 null', async () => {
  const store = createSessionStore(memoryStore());
  assert.equal(await store.load(), null);
  assert.equal(store.getSession(), null);
});

test('clear는 캐시와 저장소를 모두 지움', async () => {
  const kv = memoryStore();
  const store = createSessionStore(kv);
  await store.save(session);
  await store.clear();
  assert.equal(store.getSession(), null);
  assert.equal(store.getToken(), null);
  assert.equal(kv.data.has(KEY), false);
  assert.equal(await createSessionStore(kv).load(), null);
});

test('깨진 JSON은 null이고 캐시도 null', async () => {
  const store = createSessionStore(memoryStore({ [KEY]: '{not json' }));
  assert.equal(await store.load(), null);
  assert.equal(store.getSession(), null);
  assert.equal(store.getToken(), null);
});

test('객체가 아닌 JSON은 null', async () => {
  for (const raw of ['null', '42', '"x"', '[]', 'true']) {
    const store = createSessionStore(memoryStore({ [KEY]: raw }));
    assert.equal(await store.load(), null, raw);
    assert.equal(store.getSession(), null, raw);
  }
});

test('필드 누락·비문자열은 null이고 이전 캐시도 지움', async () => {
  for (const field of Object.keys(session) as (keyof Session)[]) {
    const missing: Record<string, unknown> = { ...session };
    delete missing[field];
    const wrongType: Record<string, unknown> = { ...session, [field]: 1 };
    for (const value of [missing, wrongType]) {
      const kv = memoryStore();
      const store = createSessionStore(kv);
      await store.save(session);
      kv.data.set(KEY, JSON.stringify(value));
      assert.equal(await store.load(), null, field);
      assert.equal(store.getSession(), null, field);
    }
  }
});

test('load 전에는 getSession·getToken이 null, load 후에는 캐시된 값', async () => {
  const kv = memoryStore({ [KEY]: JSON.stringify(session) });
  const store = createSessionStore(kv);
  assert.equal(store.getSession(), null);
  assert.equal(store.getToken(), null);
  await store.load();
  assert.equal(store.getToken(), 'tok_1');
  assert.deepEqual(store.getSession(), session);
});

test('save는 load 없이도 캐시를 갱신', async () => {
  const store = createSessionStore(memoryStore());
  await store.save(session);
  assert.equal(store.getToken(), 'tok_1');
});

test('fromSessionResponse: 필드 매핑', () => {
  const response: SessionResponse = {
    token: 'tok_9',
    trip: { id: 'trp_9', title: '부산', inviteCode: 'ABC123', status: 'preparing' },
    member: {
      id: 'mem_09',
      nickname: '지은',
      color: '#F97316',
      isHost: true,
      personaReady: false,
      mbti: null,
    },
  };
  assert.deepEqual(fromSessionResponse(response), {
    token: 'tok_9',
    tripId: 'trp_9',
    inviteCode: 'ABC123',
    memberId: 'mem_09',
    nickname: '지은',
  });
});
