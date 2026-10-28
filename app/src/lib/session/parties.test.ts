import test from 'node:test';
import assert from 'node:assert/strict';

import { createPartyActions, createPartyBook } from './parties.ts';
import { createSessionStore } from './session.ts';
import type { KeyValueStore, Session } from './session.ts';

function memoryKv(): { kv: KeyValueStore; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value);
      },
      removeItem: async (key) => {
        data.delete(key);
      },
    },
  };
}

const busan: Session = { token: 'tok_b', tripId: 'trp_busan', inviteCode: 'BSN482', memberId: 'mem_01', nickname: '민수' };
const jeju: Session = { token: 'tok_j', tripId: 'trp_jeju', inviteCode: 'JEJU77', memberId: 'mem_02', nickname: '민수' };

test('파티를 넣으면 목록에 남고 새 저장소로 복원된다(새 파티가 앞)', async () => {
  const { kv } = memoryKv();
  const book = createPartyBook(kv);
  await book.add(busan);
  await book.add(jeju);
  assert.deepEqual(book.list(), [jeju, busan]);
  const restored = createPartyBook(kv);
  assert.deepEqual(await restored.load(), [jeju, busan]);
});

test('같은 여행을 다시 넣으면 덮어쓰고 순서는 그대로', async () => {
  const book = createPartyBook(memoryKv().kv);
  await book.add(busan);
  await book.add(jeju);
  await book.add({ ...busan, token: 'tok_new' });
  assert.deepEqual(book.list().map((p) => p.tripId), ['trp_jeju', 'trp_busan']);
  assert.equal(book.list()[1]!.token, 'tok_new');
});

test('remove·clear: 목록과 저장소에서 지우고, 없는 파티를 지워도 알리지 않는다', async () => {
  const { kv, data } = memoryKv();
  const book = createPartyBook(kv);
  let calls = 0;
  book.subscribe(() => (calls += 1));
  await book.add(busan);
  await book.add(jeju);
  assert.equal(calls, 2);
  await book.remove('trp_none');
  assert.equal(calls, 2);
  await book.remove('trp_busan');
  assert.deepEqual(book.list(), [jeju]);
  await book.clear();
  assert.deepEqual(book.list(), []);
  assert.equal(data.size, 0);
});

test('list는 바뀌지 않으면 같은 배열을 돌려준다', async () => {
  const book = createPartyBook(memoryKv().kv);
  await book.add(busan);
  assert.equal(book.list(), book.list());
});

test('깨진 값·세션이 아닌 값·같은 여행 중복은 걸러낸다', async () => {
  for (const raw of ['{bad', 'null', '{}', '"x"']) {
    const { kv, data } = memoryKv();
    data.set('journey.parties.v1', raw);
    assert.deepEqual(await createPartyBook(kv).load(), [], raw);
  }
  const { kv, data } = memoryKv();
  data.set('journey.parties.v1', JSON.stringify([busan, { nope: 1 }, { ...busan, token: 'dup' }, jeju, { ...jeju, extra: 'x' }]));
  assert.deepEqual(await createPartyBook(kv).load(), [busan, jeju]);
});

test('저장이 실패해도 메모리 목록은 바뀐다', async () => {
  const kv: KeyValueStore = { getItem: async () => null, setItem: async () => { throw new Error('boom'); }, removeItem: async () => {} };
  const book = createPartyBook(kv);
  await assert.rejects(() => book.add(busan));
  assert.deepEqual(book.list(), [busan]);
});

function setup() {
  const session = createSessionStore(memoryKv().kv);
  const parties = createPartyBook(memoryKv().kv);
  return { session, parties, actions: createPartyActions(session, parties) };
}

test('join: 목록에 넣고 그 파티로 들어간다', async () => {
  const { session, parties, actions } = setup();
  await actions.join(busan);
  assert.deepEqual(parties.list(), [busan]);
  assert.deepEqual(session.getSession(), busan);
});

test('여러 파티에 들어가 있어도 enter로 오가고, exit은 파티를 남긴 채 초기 화면으로 나온다', async () => {
  const { session, parties, actions } = setup();
  await actions.join(busan);
  await actions.join(jeju);
  assert.equal(session.getToken(), 'tok_j');
  assert.equal(await actions.enter('trp_busan'), true);
  assert.equal(session.getToken(), 'tok_b');
  await actions.exit();
  assert.equal(session.getSession(), null);
  assert.equal(parties.list().length, 2);
  assert.equal(await actions.enter('trp_none'), false);
  assert.equal(session.getSession(), null);
});

test('leave: 들어가 있던 파티를 나가면 목록에서 지우고 초기 화면으로, 다른 파티를 나가도 지금 파티는 그대로', async () => {
  const { session, parties, actions } = setup();
  await actions.join(busan);
  await actions.join(jeju);
  await actions.leave('trp_busan');
  assert.deepEqual(parties.list(), [jeju]);
  assert.deepEqual(session.getSession(), jeju);
  await actions.leave('trp_jeju');
  assert.deepEqual(parties.list(), []);
  assert.equal(session.getSession(), null);
});
