import { createValueStore } from '../store/valueStore.ts';
import type { InviteInfo } from '../persona/types.ts';

/** 서버에서 받아 온 파티 정보(제목·구성원·상태)를 여행 id별로 들고 있는다. 상단 줄·파티 목록이 같이 쓴다. 앱을 끄면 사라진다. */
export const partyInfo = createValueStore<Record<string, InviteInfo>>({});

export function putPartyInfo(info: InviteInfo): void {
  const current = partyInfo.get();
  partyInfo.set({ ...current, [info.trip.id]: info });
}

export function forgetPartyInfo(tripId: string): void {
  const { [tripId]: _gone, ...rest } = partyInfo.get();
  partyInfo.set(rest);
}
