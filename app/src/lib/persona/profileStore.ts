import { useSyncExternalStore } from 'react';

import { asyncStorageAdapter } from '../storage/asyncStorage.ts';
import { createProfileStore } from './profile.ts';
import type { Profile } from './profile.ts';

/** 이 폰에 저장된 내 성향(1~12번). 없으면(null) 아직 성향 검사를 안 한 것이다. */
export const profile = createProfileStore(asyncStorageAdapter);

export function useProfile(): Profile | null {
  return useSyncExternalStore(profile.subscribe, profile.get, profile.get);
}
