import { useSyncExternalStore } from 'react';

import { session } from './index.ts';
import type { Session } from './session.ts';

/** 지금 저장된 세션(참여한 여행). 없으면 null. 바뀌면 화면이 다시 그려진다. */
export function useSession(): Session | null {
  return useSyncExternalStore(session.subscribe, session.getSession, session.getSession);
}
