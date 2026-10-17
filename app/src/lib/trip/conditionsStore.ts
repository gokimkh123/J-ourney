import type { ConditionsBody } from './conditions.ts';

/**
 * 회의 조건을 잠깐 들고 있는 곳. 서버(PUT /trips/{id}/conditions)가 열리기 전까지는
 * B1에서 정한 조건을 B2 회의 화면이 여기서 읽는다. 앱을 끄면 사라진다.
 */
export type ConditionsStore = {
  get(): ConditionsBody | null;
  set(body: ConditionsBody | null): void;
  subscribe(listener: () => void): () => void;
};

export function createConditionsStore(): ConditionsStore {
  let current: ConditionsBody | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(body) {
      current = body;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const conditionsStore = createConditionsStore();
