import { useSyncExternalStore } from 'react';

import { parties } from './index.ts';
import type { Session } from './session.ts';

/** 내가 참여 중인 파티 목록. 바뀌면 화면이 다시 그려진다. */
export function useParties(): Session[] {
  return useSyncExternalStore(parties.subscribe, parties.list, parties.list);
}
