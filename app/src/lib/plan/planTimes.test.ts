import assert from 'node:assert/strict';
import test from 'node:test';

import type { KeyValueStore } from '../session/session.ts';
import { applyPending, createPlanTimesStore, parseClock, pendingCount, withPending } from './planTimes.ts';

function memoryKv(initial: Record<string, string> = {}): { kv: KeyValueStore; data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    kv: {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value);
      },
      removeItem: async (key) => {
        data.delete(key);
      },
    },
    data,
  };
}

test('시각 글자를 분으로 읽고 틀린 모양은 null', () => {
  assert.equal(parseClock('09:30'), 570);
  assert.equal(parseClock('23:59'), 1439);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('9:30'), null);
  assert.equal(parseClock('12:60'), null);
});

test('고치는 중인 시각을 얹고, null은 저장된 시각을 지운다', () => {
  const saved = { 1: { a: 600, b: 700 } };
  const pending = withPending(withPending({}, 1, 'a', null), 2, 'c', 800);
  assert.deepEqual(applyPending(saved, pending), { 1: { b: 700 }, 2: { c: 800 } });
  assert.deepEqual(applyPending({ 1: { a: 600 } }, withPending({}, 1, 'a', null)), {});
});

test('저장된 것과 같은 값은 고친 수에 세지 않는다', () => {
  const saved = { 1: { a: 600 } };
  assert.equal(pendingCount(saved, withPending({}, 1, 'a', 600)), 0);
  assert.equal(pendingCount(saved, withPending(withPending({}, 1, 'a', 610), 1, 'b', null)), 1);
  assert.equal(pendingCount(saved, withPending({}, 1, 'a', null)), 1);
});

test('저장하면 바로 알리고, 다시 불러와도 같다', async () => {
  const { kv } = memoryKv();
  const store = createPlanTimesStore(kv);
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  await store.save('trp_1', { 1: { plc_a: 600 } });
  assert.equal(notified, 1);
  assert.deepEqual(store.get(), { trp_1: { 1: { plc_a: 600 } } });
  const again = createPlanTimesStore(kv);
  await again.load();
  assert.deepEqual(again.get(), { trp_1: { 1: { plc_a: 600 } } });
  await store.save('trp_1', {});
  assert.deepEqual(store.get(), {});
});

test('저장된 글이 깨졌거나 모양이 틀린 칸은 버린다', async () => {
  const broken = createPlanTimesStore(memoryKv({ 'journey.planTimes.v1': '{oops' }).kv);
  await broken.load();
  assert.deepEqual(broken.get(), {});
  const raw = JSON.stringify({ t1: { 1: { a: 600, b: -5, c: 2000, d: 'x' }, x: { a: 1 } }, t2: [] });
  const odd = createPlanTimesStore(memoryKv({ 'journey.planTimes.v1': raw }).kv);
  await odd.load();
  assert.deepEqual(odd.get(), { t1: { 1: { a: 600 } } });
});
