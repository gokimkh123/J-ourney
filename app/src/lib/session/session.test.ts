import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore, fromSessionResponse } from './session.ts';
import type { KeyValueStore, Session } from './session.ts';
import type { SessionResponse } from '../persona/types.ts';

function memoryStore(): { kv: KeyValueStore; data: Map<string, string> } {
  const data = new Map<string, string>();
  const kv: KeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
  return { kv, data };
}

const session: Session = {
  token: 'tok_mem_01_ABC123',
  tripId: 'trp_1',
  inviteCode: 'BSN482',
  memberId: 'mem_01',
  nickname: '민수',
};

// 저장소에 쓰인 유일한 키에 raw 값을 덮어쓴다.
async function saveThenOverwrite(raw: string): Promise<ReturnType<typeof createSessionStore>> {
  const { kv, data } = memoryStore();
  const store = createSessionStore(kv);
  await store.save(session);
  const [key] = [...data.keys()];
  data.set(key, raw);
  return store;
}

test('저장 전 load는 null', async () => {
  const store = createSessionStore(memoryStore().kv);
  assert.equal(await store.load(), null);
  assert.equal(store.getSession(), null);
  assert.equal(store.getToken(), null);
});

test('저장하고 새 저장소로 복원', async () => {
  const { kv } = memoryStore();
  await createSessionStore(kv).save(session);
  const restored = createSessionStore(kv);
  assert.deepEqual(await restored.load(), session);
});

test('load 전에는 캐시가 비어 있고 load 후 getSession/getToken이 채워짐', async () => {
  const { kv } = memoryStore();
  await createSessionStore(kv).save(session);
  const store = createSessionStore(kv);
  assert.equal(store.getSession(), null);
  assert.equal(store.getToken(), null);
  await store.load();
  assert.deepEqual(store.getSession(), session);
  assert.equal(store.getToken(), 'tok_mem_01_ABC123');
});

test('save 직후 캐시가 갱신됨', async () => {
  const store = createSessionStore(memoryStore().kv);
  await store.save(session);
  assert.deepEqual(store.getSession(), session);
  assert.equal(store.getToken(), 'tok_mem_01_ABC123');
  await store.save({ ...session, token: 'tok_new' });
  assert.equal(store.getToken(), 'tok_new');
});

test('clear 후 getToken은 null이고 저장소에서도 삭제됨', async () => {
  const { kv, data } = memoryStore();
  const store = createSessionStore(kv);
  await store.save(session);
  assert.equal(data.size, 1);
  await store.clear();
  assert.equal(store.getToken(), null);
  assert.equal(store.getSession(), null);
  assert.equal(data.size, 0);
  assert.equal(await createSessionStore(kv).load(), null);
});

test('깨진 JSON·필드 누락·잘못된 타입은 null이고 캐시도 비움', async () => {
  const { token: _token, ...noToken } = session;
  const { nickname: _nickname, ...noNickname } = session;
  const bad = [
    '{not json',
    '',
    'null',
    '[]',
    '"text"',
    '123',
    JSON.stringify({}),
    JSON.stringify(noToken),
    JSON.stringify(noNickname),
    JSON.stringify({ ...session, tripId: 1 }),
    JSON.stringify({ ...session, token: null }),
    JSON.stringify({ ...session, memberId: ['mem_01'] }),
    JSON.stringify({ ...session, inviteCode: {} }),
  ];
  for (const raw of bad) {
    const store = await saveThenOverwrite(raw);
    assert.equal(await store.load(), null, raw);
    assert.equal(store.getSession(), null, raw);
    assert.equal(store.getToken(), null, raw);
  }
});

test('저장된 값의 여분 필드는 무시함', async () => {
  const store = await saveThenOverwrite(JSON.stringify({ ...session, extra: 'x' }));
  assert.deepEqual(await store.load(), session);
});

test('fromSessionResponse가 각 값을 올바른 필드에 넣음', () => {
  const response: SessionResponse = {
    trip: { id: 'trp_9', title: '제주 여행', inviteCode: 'JEJU77', status: 'preparing' },
    member: {
      id: 'mem_07',
      nickname: '하늘',
      color: '#EC4899',
      isHost: false,
      personaReady: false,
      title: null,
    },
    token: 'tok_mem_07_XYZ',
  };
  assert.deepEqual(fromSessionResponse(response), {
    token: 'tok_mem_07_XYZ',
    tripId: 'trp_9',
    inviteCode: 'JEJU77',
    memberId: 'mem_07',
    nickname: '하늘',
  });
});
