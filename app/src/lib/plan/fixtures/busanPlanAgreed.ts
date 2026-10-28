import type { Plan, PlanItem, PlanMove } from '../types.ts';
import { busanPlan, items } from './busanPlan.ts';

function bus(minutes: number, distanceM: number, fareWon: number): PlanMove {
  return { mode: 'bus', minutes, distanceM, fareWon, source: 'kakao', routeUrl: 'https://map.kakao.com/link/by/bus/route' };
}

// 첫 합의안(pln_03)의 둘째 날은 대변항 → 해동용궁사 → 청사포 → 해운대 순서다(일찍 출발해 동쪽 끝부터).
// 같은 장소를 쓰되 시간·이동을 이 순서에 맞춘다. 서연의 수정 요청으로 확정안(pln_04)은 해운대부터 동쪽으로 간다.
const anchovy: PlanItem = {
  ...items.itm_09!,
  startTime: '10:30',
  title: '대변항 멸치 구경과 이른 점심',
  moveFromPrev: null,
  reasons: [
    { memberId: 'mem_03', text: '멸치회가 가성비 좋아요.' },
    { memberId: 'mem_01', text: '일찍 출발해 낮 시간을 넉넉히 써요.' },
  ],
};

const temple: PlanItem = {
  ...items.itm_10!,
  startTime: '12:30',
};

const bridgeLookout: PlanItem = {
  ...items.itm_05!,
  startTime: '14:30',
  moveFromPrev: bus(25, 6800, 1750),
};

const beach: PlanItem = {
  ...items.itm_06!,
  startTime: '16:30',
  title: '해운대 해수욕장 저녁 산책',
  moveFromPrev: bus(20, 4200, 1550),
  reasons: [
    { memberId: 'mem_02', text: '탁 트인 바다에서 여행을 마무리해요.' },
    { memberId: 'mem_04', text: '해 질 무렵에 걷기 편한 해변이에요.' },
  ],
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
    { memberId: 'mem_02', gave: '송도해상케이블카', got: '다대포 일몰' },
    { memberId: 'mem_04', gave: '범어사', got: '흰여울 카페 시간' },
  ],
  votes: ['mem_01', 'mem_02', 'mem_03', 'mem_04'].map((memberId) => ({ memberId, decision: 'pending' as const })),
  days: [
    busanPlan.days[0]!,
    { day: 2, date: busanPlan.days[1]!.date, items: [anchovy, temple, bridgeLookout, beach] },
  ],
};
