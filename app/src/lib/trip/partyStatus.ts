import type { InviteInfo } from '../persona/types.ts';

/** 화면의 상태 라벨 색 이름(theme의 Tone과 같다. lib는 theme를 가져오지 않아 따로 적는다) */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export type PartyStatus = { label: string; tone: Tone };

/** 내 파티 목록의 카드에 보여 줄 한 줄 상태. 정보를 아직 못 받았으면 null. */
export function partyStatus(info: InviteInfo | undefined): PartyStatus | null {
  if (info === undefined) return null;
  switch (info.trip.status) {
    case 'meeting':
      return { label: 'AI 회의 중', tone: 'accent' };
    case 'voting':
      return { label: '확정 투표 중', tone: 'warning' };
    case 'confirmed':
      return { label: '일정 확정', tone: 'success' };
    case 'preparing': {
      const total = info.members.length;
      const ready = info.members.filter((m) => m.personaReady).length;
      if (total > 0 && ready < total) return { label: `성향 기다리는 중 ${ready}/${total}`, tone: 'warning' };
      return { label: '회의 준비 완료', tone: 'success' };
    }
  }
}
