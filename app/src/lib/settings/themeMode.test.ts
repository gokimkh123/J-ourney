import test from 'node:test';
import assert from 'node:assert/strict';

import { THEME_MODE_KEY, createThemeModeStore, parseThemeMode } from './themeMode.ts';
import type { KeyValueStore } from '../session/session.ts';

function memoryKv(initial?: string): { kv: KeyValueStore; data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[THEME_MODE_KEY, initial]]);
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

test('알 수 없는 값은 시스템', () => {
  assert.equal(parseThemeMode(null), 'system');
  assert.equal(parseThemeMode('dark'), 'dark');
  assert.equal(parseThemeMode('light'), 'light');
  assert.equal(parseThemeMode('purple'), 'system');
  assert.equal(parseThemeMode(''), 'system');
});

test('저장한 모드를 새 저장소가 불러온다', async () => {
  const { kv, data } = memoryKv();
  const store = createThemeModeStore(kv);
  assert.equal(store.getMode(), 'system');
  await store.set('dark');
  assert.equal(data.get(THEME_MODE_KEY), 'dark');
  assert.equal(await createThemeModeStore(kv).load(), 'dark');
});

test('set은 구독자를 부르고 저장이 실패해도 메모리 값은 바뀐다', async () => {
  const { kv } = memoryKv();
  const store = createThemeModeStore({ ...kv, setItem: async () => { throw new Error('boom'); } });
  const seen: string[] = [];
  const off = store.subscribe(() => seen.push(store.getMode()));
  await assert.rejects(() => store.set('light'));
  assert.deepEqual(seen, ['light']);
  assert.equal(store.getMode(), 'light');
  off();
  await assert.rejects(() => store.set('dark'));
  assert.deepEqual(seen, ['light']);
});

test('읽기 실패는 시스템 모드로', async () => {
  const { kv } = memoryKv('dark');
  const store = createThemeModeStore({ ...kv, getItem: async () => { throw new Error('boom'); } });
  assert.equal(await store.load(), 'system');
});
