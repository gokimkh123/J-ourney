import { useCallback, useSyncExternalStore } from 'react';

import { endpoints } from '../api/index.ts';
import { ApiError } from '../api/errors.ts';
import type { InviteInfo } from '../persona/types.ts';
import { partyInfo, putPartyInfo } from './partyInfo.ts';
import type { Session } from './session.ts';

/** 파티 정보 전체(여행 id → 정보). 바뀌면 화면이 다시 그려진다. */
export function usePartyInfos(): Record<string, InviteInfo> {
  return useSyncExternalStore(partyInfo.subscribe, partyInfo.get, partyInfo.get);
}

/**
 * 파티 하나의 정보를 서버에서 받아 저장해 두는 함수. 실패하면 조용히 넘어가고 이전 값을 그대로 둔다.
 * 초대 코드가 없으면(404, 방장이 파티를 없앰) "gone"을 돌려준다. 빼는 것은 부르는 쪽이 정한다.
 */
export function useRefreshParty(): (s: Session) => Promise<'ok' | 'gone' | 'failed'> {
  return useCallback(async (s: Session) => {
    try {
      putPartyInfo(await endpoints.getInvite(s.inviteCode));
      return 'ok';
    } catch (e) {
      // 목록은 이전에 받은 값(없으면 이름 없이)으로 보여 준다.
      return e instanceof ApiError && e.status === 404 ? 'gone' : 'failed';
    }
  }, []);
}
