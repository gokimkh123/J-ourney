import type { Plan, PlanItem, PlanMove, PlanPlace } from '../types.ts';

function place(
  id: string,
  name: string,
  address: string,
  lat: number,
  lng: number,
  openHours: string | null,
  menu: string | null,
  popularity: number,
  crowd: number,
  priceLevel: number,
  verified: boolean,
): PlanPlace {
  const q = encodeURIComponent(name);
  return {
    id,
    name,
    address,
    lat,
    lng,
    openHours,
    menu,
    popularity,
    crowd,
    priceLevel,
    kakaoPlaceId: verified ? `kk_${id}` : null,
    verified,
    links: verified
      ? { kakaoMap: `https://place.map.kakao.com/kk_${id}`, naverMap: `https://map.naver.com/p/search/${q}` }
      : { kakaoMap: `https://map.kakao.com/link/search/${q}`, naverMap: `https://map.naver.com/p/search/${q}` },
    sources: verified ? ['tourapi', 'kakao'] : ['tourapi'],
    baseDate: '2026-10-01',
    checkedAt: '2026-10-24T14:00:00+09:00',
  };
}

function move(mode: string, minutes: number, distanceM: number, fareWon: number): PlanMove {
  return { mode, minutes, distanceM, fareWon, source: 'kakao', routeUrl: `https://map.kakao.com/link/by/${mode}/route` };
}

const items: Record<string, PlanItem> = {
  itm_01: {
    id: 'itm_01',
    startTime: '09:00',
    title: '돼지국밥으로 아침 식사',
    category: 'food',
    costPerPerson: 9000,
    moveFromPrev: null,
    place: place('plc_01', '○○ 돼지국밥', '부산 동래구 온천장로 1', 35.1262, 129.034, '09:00-21:00', '돼지국밥', 82, 55, 1, true),
    forMembers: ['mem_01', 'mem_03'],
    reasons: [
      { memberId: 'mem_01', text: '든든하게 시작하는 첫 일정으로 시간표에 딱 맞아요.' },
      { memberId: 'mem_03', text: '가격이 합리적이라 예산을 아낄 수 있어요.' },
    ],
  },
  itm_04: {
    id: 'itm_04',
    startTime: '11:00',
    title: '흰여울문화마을 산책',
    category: 'sightseeing',
    costPerPerson: 3000,
    moveFromPrev: move('bus', 35, 14200, 1550),
    place: place('plc_04', '흰여울문화마을', '부산 영도구 영선동4가', 35.0786, 129.0446, null, null, 64, 35, 0, true),
    forMembers: ['mem_04', 'mem_03'],
    reasons: [
      { memberId: 'mem_04', text: '붐비지 않고 바다를 보며 여유롭게 걸을 수 있어요.' },
      { memberId: 'mem_03', text: '다음 장소와 가까워 동선이 짧아요.' },
    ],
  },
  itm_02: {
    id: 'itm_02',
    startTime: '15:00',
    title: '자갈치시장 구경과 간식',
    category: 'market',
    costPerPerson: 25000,
    moveFromPrev: move('bus', 20, 5400, 1550),
    place: place('plc_02', '자갈치시장', '부산 중구 자갈치해안로 52', 35.0967, 129.0305, '05:00-22:00', '회, 어묵', 91, 78, 2, true),
    forMembers: ['mem_01', 'mem_02'],
    reasons: [
      { memberId: 'mem_01', text: '순서를 바꿔 이동 시간을 줄였어요.' },
      { memberId: 'mem_02', text: '부산다운 분위기를 느낄 수 있어요.' },
    ],
  },
  itm_05: {
    id: 'itm_05',
    startTime: '10:30',
    title: '늦은 아침 카페 휴식',
    category: 'cafe',
    costPerPerson: 8000,
    moveFromPrev: null,
    place: place('plc_05', '○○ 카페', '부산 수영구 남천동', 35.07, 129.066, '10:00-22:00', '커피, 디저트', 58, 30, 1, false),
    forMembers: ['mem_04', 'mem_02'],
    reasons: [
      { memberId: 'mem_04', text: '늦게 일어나도 천천히 시작할 수 있어요.' },
      { memberId: 'mem_02', text: '감성적인 분위기에서 사진을 남기기 좋아요.' },
    ],
  },
  itm_07: {
    id: 'itm_07',
    startTime: '13:30',
    title: '온천에서 쉬어 가기',
    category: 'spa',
    costPerPerson: 15000,
    moveFromPrev: move('subway', 40, 16800, 1650),
    place: place('plc_07', '○○ 온천', '부산 동래구 온천동', 35.219, 129.089, '06:00-21:00', null, 70, 40, 2, false),
    forMembers: ['mem_02', 'mem_04'],
    reasons: [
      { memberId: 'mem_02', text: '여행 마지막에 쉬어 가기 좋아요.' },
      { memberId: 'mem_04', text: '조용히 몸을 풀며 쉴 수 있어요.' },
    ],
  },
  itm_03: {
    id: 'itm_03',
    startTime: '18:00',
    title: '광안리 회센터 저녁',
    category: 'food',
    costPerPerson: 45000,
    moveFromPrev: move('subway', 45, 21500, 1750),
    place: place('plc_03', '광안리 회센터', '부산 수영구 광안해변로 219', 35.1555, 129.1345, '11:00-23:00', '모둠회', 88, 70, 3, true),
    forMembers: ['mem_01', 'mem_02', 'mem_03', 'mem_04'],
    reasons: [
      { memberId: 'mem_02', text: '마지막 저녁을 바다 앞에서 먹고 싶어요.' },
      { memberId: 'mem_03', text: '저녁 회가 가성비 좋아요.' },
    ],
  },
};

export const busanPlan: Plan = {
  id: 'pln_04',
  version: 4,
  status: 'confirmed',
  costPerPerson: 105000,
  budgetPerPerson: 250000,
  maxStepsPerDay: 4,
  satisfaction: [
    { memberId: 'mem_01', score: 8 },
    { memberId: 'mem_02', score: 9 },
    { memberId: 'mem_03', score: 8 },
    { memberId: 'mem_04', score: 9 },
  ],
  concessions: [{ memberId: 'mem_01', gave: '둘째 날 이른 출발', got: '일정 순서 유지' }],
  votes: [
    { memberId: 'mem_01', decision: 'approve' },
    { memberId: 'mem_02', decision: 'approve' },
    { memberId: 'mem_03', decision: 'approve' },
    { memberId: 'mem_04', decision: 'approve' },
  ],
  days: [
    { day: 1, date: '2026-11-14', items: [items.itm_01!, items.itm_04!, items.itm_02!] },
    { day: 2, date: '2026-11-15', items: [items.itm_05!, items.itm_07!, items.itm_03!] },
  ],
};
