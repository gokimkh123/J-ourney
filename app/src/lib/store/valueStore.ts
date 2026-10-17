/** 값 하나를 들고 있다가 바뀌면 구독자에게 알리는 아주 작은 저장소(화면 사이 전달용, 앱을 끄면 사라진다). */
export type ValueStore<T> = {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
};

export function createValueStore<T>(initial: T): ValueStore<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(value) {
      current = value;
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
