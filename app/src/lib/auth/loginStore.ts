import type { KeyValueStore } from '../session/session.ts';
import { isExpired, toLogin, type Login } from './login.ts';

export type LoginStore = {
  load(): Promise<Login | null>;
  save(login: Login): Promise<void>;
  clear(): Promise<void>;
  /** 만료된 로그인은 없는 것으로 본다. */
  get(): Login | null;
  getToken(): string | null;
  subscribe(listener: () => void): () => void;
};

const STORAGE_KEY = 'journey.login.v1';

/** 카카오 로그인 토큰을 폰에 저장한다. 여행 세션(journey.session.v1)과는 따로다. */
export function createLoginStore(kv: KeyValueStore, now: () => number = Date.now): LoginStore {
  let cache: Login | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  };
  const current = () => (cache !== null && isExpired(cache, now()) ? null : cache);

  return {
    async load() {
      let value: unknown = null;
      try {
        const raw = await kv.getItem(STORAGE_KEY);
        value = raw === null ? null : JSON.parse(raw);
      } catch {
        value = null;
      }
      cache = toLogin(value);
      notify();
      return current();
    },
    async save(login) {
      cache = login;
      notify();
      await kv.setItem(STORAGE_KEY, JSON.stringify(login));
    },
    async clear() {
      cache = null;
      notify();
      await kv.removeItem(STORAGE_KEY);
    },
    get: current,
    getToken: () => current()?.token ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
