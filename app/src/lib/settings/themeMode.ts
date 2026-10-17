import type { KeyValueStore } from '../session/session.ts';

/** 화면 모드. 'system'이면 휴대폰의 다크 모드 설정을 따른다. */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_KEY = 'journey.themeMode.v1';

export function parseThemeMode(raw: string | null): ThemeMode {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export type ThemeModeStore = {
  load(): Promise<ThemeMode>;
  set(mode: ThemeMode): Promise<void>;
  getMode(): ThemeMode;
  subscribe(listener: () => void): () => void;
};

export function createThemeModeStore(kv: KeyValueStore): ThemeModeStore {
  let mode: ThemeMode = 'system';
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    async load() {
      let raw: string | null = null;
      try {
        raw = await kv.getItem(THEME_MODE_KEY);
      } catch {
        // 읽지 못하면 기본값(시스템)으로 둔다.
      }
      mode = parseThemeMode(raw);
      notify();
      return mode;
    },
    async set(next) {
      // 화면은 바로 바꾸고, 저장은 그다음에 한다. 저장이 실패해도 이번 실행 동안은 바뀐 채로 둔다.
      mode = next;
      notify();
      await kv.setItem(THEME_MODE_KEY, next);
    },
    getMode: () => mode,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
