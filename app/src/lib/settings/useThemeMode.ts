import { useSyncExternalStore } from 'react';

import { themeMode } from './index.ts';
import type { ThemeMode } from './themeMode.ts';

/** 저장된 화면 모드. 바뀌면 화면이 다시 그려진다. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(themeMode.subscribe, themeMode.getMode, themeMode.getMode);
}
