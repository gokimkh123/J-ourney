import { createValueStore } from '../store/valueStore.ts';
import type { InviteInfo } from '../persona/types.ts';

/** 서버에서 받아 온 파티 정보(제목·구성원·상태)를 여행 id별로 들고 있는다. 상단 줄·파티 목록이 같이 쓴다. 앱을 끄면 사라진다. */
export const partyInfo = createValueStore<Record<string, InviteInfo>>({});

export function putPartyInfo(info: InviteInfo): void {
  const current = partyInfo.get();
  // 홈·조건·내 캐릭터가 3초마다 같은 정보를 다시 받아도 저장소를 바꾸지 않는다(11/3). 바꾸면 이 정보를 쓰는
  // 떠 있는 모든 화면(뒤에 숨은 회의 지도·대화, 일정 화면 포함)이 3초마다 다시 그려져 앱이 점점 느려졌다.
  const old = current[info.trip.id];
  if (old !== undefined && JSON.stringify(old) === JSON.stringify(info)) return;
  partyInfo.set({ ...current, [info.trip.id]: info });
}

/**
 * 내 성향 검사를 막 냈을 때, 받아 둔 정보에서 내 준비 표시를 바로 켠다(11/4). 다음 새로 받기를 기다리면 질문을 끝내고
 * 내 캐릭터 탭으로 와도 "회의 시작하기"가 바로 안 떴다. 서버는 이미 받았으니 다음에 받는 값과 같다.
 */
export function markPersonaReady(tripId: string, memberId: string): void {
  const info = partyInfo.get()[tripId];
  if (info === undefined || !info.members.some((m) => m.id === memberId && !m.personaReady)) return;
  putPartyInfo({ ...info, members: info.members.map((m) => (m.id === memberId ? { ...m, personaReady: true } : m)) });
}

export function forgetPartyInfo(tripId: string): void {
  const { [tripId]: _gone, ...rest } = partyInfo.get();
  partyInfo.set(rest);
}
