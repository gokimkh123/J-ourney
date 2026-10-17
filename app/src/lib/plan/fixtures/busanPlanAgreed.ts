import type { Plan, PlanItem, PlanMove } from '../types.ts';
import { busanPlan, items } from './busanPlan.ts';

function subway(minutes: number, distanceM: number, fareWon: number): PlanMove {
  return { mode: 'subway', minutes, distanceM, fareWon, source: 'kakao', routeUrl: 'https://map.kakao.com/link/by/subway/route' };
}

// 첫 합의안(pln_03)의 둘째 날은 카페 → 회센터 → 온천 순서다. 같은 장소를 쓰되 시간·이동만 이 순서에 맞춘다.
const lunch: PlanItem = {
  ...items.itm_03!,
  startTime: '12:30',
  title: '광안리 회센터 점심',
  moveFromPrev: subway(35, 14800, 1650),
  reasons: [
    { memberId: 'mem_02', text: '바다 앞에서 회를 먹고 싶어요.' },
    { memberId: 'mem_03', text: '점심 회가 저녁보다 저렴해요.' },
  ],
};

const spa: PlanItem = {
  ...items.itm_07!,
  startTime: '15:30',
  moveFromPrev: subway(45, 21500, 1750),
};

/**
 * AI 회의가 처음 합의한 일정(pln_03). 회의 재생이 첫 합의에서 멈추므로 합의안·일정 화면은 이 안을 보여 준다.
 * 사람 투표 전이라 상태는 voting, 투표는 모두 대기 중이다. 만족도·양보는 busanEvents의 첫 meeting.agreed와 같다.
 */
export const busanPlanAgreed: Plan = {
  ...busanPlan,
  id: 'pln_03',
  version: 3,
  status: 'voting',
  satisfaction: [
    { memberId: 'mem_01', score: 8 },
    { memberId: 'mem_02', score: 8 },
    { memberId: 'mem_03', score: 7 },
    { memberId: 'mem_04', score: 9 },
  ],
  concessions: [
    { memberId: 'mem_02', gave: '해운대 해돋이', got: '오후 카페' },
    { memberId: 'mem_01', gave: '빡빡한 시간표', got: '돼지국밥 첫 일정' },
  ],
  votes: ['mem_01', 'mem_02', 'mem_03', 'mem_04'].map((memberId) => ({ memberId, decision: 'pending' as const })),
  days: [
    busanPlan.days[0]!,
    { day: 2, date: busanPlan.days[1]!.date, items: [items.itm_05!, lunch, spa] },
  ],
};
