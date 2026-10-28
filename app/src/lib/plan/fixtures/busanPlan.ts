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
    // 예시 장소의 카카오 장소 ID는 가짜라 장소 페이지 링크가 열리지 않는다. 확인 여부와 관계없이 이름 검색 링크를 쓴다.
    links: { kakaoMap: `https://map.kakao.com/link/search/${q}`, naverMap: `https://map.naver.com/p/search/${q}` },
    sources: verified ? ['tourapi', 'kakao'] : ['tourapi'],
    baseDate: '2026-10-01',
    checkedAt: '2026-10-24T14:00:00+09:00',
  };
}

function move(mode: string, minutes: number, distanceM: number, fareWon: number): PlanMove {
  return { mode, minutes, distanceM, fareWon, source: 'kakao', routeUrl: `https://map.kakao.com/link/by/${mode}/route` };
}

// 부산 전역 1박 2일 예시. 좌표는 대략적인 값이고, 이동 시간·거리는 대중교통과 택시를 섞은 추정치다(실제 길찾기 확인 필요).
export const items: Record<string, PlanItem> = {
  itm_01: {
    id: 'itm_01',
    startTime: '10:00',
    title: '국제시장 구경과 먹거리',
    category: 'food',
    costPerPerson: 9000,
    moveFromPrev: null,
    place: place('plc_01', '국제시장·깡통시장', '부산 중구 신창동4가', 35.1007, 129.0285, '09:00-20:00', '씨앗호떡, 어묵', 82, 55, 1, true),
    forMembers: ['mem_01', 'mem_03'],
    reasons: [
      { memberId: 'mem_01', text: '든든하게 시작하는 첫 일정으로 시간표에 딱 맞아요.' },
      { memberId: 'mem_03', text: '가격이 합리적이라 예산을 아낄 수 있어요.' },
    ],
  },
  itm_02: {
    id: 'itm_02',
    startTime: '11:30',
    title: '자갈치시장 구경과 점심',
    category: 'market',
    costPerPerson: 25000,
    moveFromPrev: move('walk', 8, 500, 0),
    place: place('plc_02', '자갈치시장', '부산 중구 자갈치해안로 52', 35.0967, 129.0305, '05:00-22:00', '회, 어묵', 91, 78, 2, true),
    forMembers: ['mem_01', 'mem_02'],
    reasons: [
      { memberId: 'mem_01', text: '국제시장에서 걸어갈 수 있어 이동이 짧아요.' },
      { memberId: 'mem_02', text: '바다 앞 시장에서 부산다운 분위기를 느낄 수 있어요.' },
    ],
  },
  itm_04: {
    id: 'itm_04',
    startTime: '13:30',
    title: '흰여울문화마을 산책과 카페',
    category: 'sightseeing',
    costPerPerson: 7000,
    moveFromPrev: move('bus', 15, 3500, 1550),
    place: place('plc_04', '흰여울문화마을', '부산 영도구 영선동4가', 35.0786, 129.0446, null, null, 64, 35, 0, true),
    forMembers: ['mem_04', 'mem_03'],
    reasons: [
      { memberId: 'mem_04', text: '붐비지 않고 바다를 보며 여유롭게 걸을 수 있어요.' },
      { memberId: 'mem_03', text: '자갈치시장에서 가까워 동선이 짧아요.' },
    ],
  },
  itm_08: {
    id: 'itm_08',
    startTime: '15:30',
    title: '감천문화마을 골목 산책',
    category: 'sightseeing',
    costPerPerson: 2000,
    moveFromPrev: move('bus', 20, 4800, 1550),
    place: place('plc_08', '감천문화마을', '부산 사하구 감천동', 35.0975, 129.0106, '09:00-18:00', null, 87, 72, 0, true),
    forMembers: ['mem_02', 'mem_01'],
    reasons: [
      { memberId: 'mem_02', text: '알록달록한 골목에서 사진을 남기기 좋아요.' },
      { memberId: 'mem_01', text: '오후 일찍 넣으면 일몰 시간에 맞출 수 있어요.' },
    ],
  },
  itm_07: {
    id: 'itm_07',
    startTime: '17:30',
    title: '다대포 일몰 감상',
    category: 'sightseeing',
    costPerPerson: 0,
    moveFromPrev: move('bus', 30, 9800, 1550),
    place: place('plc_07', '다대포 꿈의낙조분수', '부산 사하구 다대동', 35.0472, 128.9658, null, null, 72, 50, 0, false),
    forMembers: ['mem_02', 'mem_04'],
    reasons: [
      { memberId: 'mem_02', text: '낙조분수 앞에서 보는 일몰이 첫날 하이라이트예요.' },
      { memberId: 'mem_04', text: '흰여울에서 쉬는 시간을 지키는 조건으로 동의했어요.' },
    ],
  },
  itm_03: {
    id: 'itm_03',
    startTime: '20:30',
    title: '광안리 저녁과 야경, 숙박',
    category: 'food',
    costPerPerson: 60000,
    moveFromPrev: move('subway', 65, 25000, 1750),
    place: place('plc_03', '광안리 해변과 야경', '부산 수영구 광안해변로 219', 35.1532, 129.1186, '상시 개방', '모둠회', 88, 70, 3, true),
    forMembers: ['mem_01', 'mem_02', 'mem_03', 'mem_04'],
    reasons: [
      { memberId: 'mem_02', text: '광안대교 야경을 보며 하루를 마무리하고 싶어요.' },
      { memberId: 'mem_03', text: '숙소를 여기로 잡으면 둘째 날 동쪽 이동이 줄어요.' },
    ],
  },
  itm_06: {
    id: 'itm_06',
    startTime: '09:30',
    title: '해운대 해수욕장 아침 산책',
    category: 'sightseeing',
    costPerPerson: 12000,
    moveFromPrev: null,
    place: place('plc_06', '해운대 해수욕장', '부산 해운대구 해운대해변로 264', 35.1587, 129.1604, '상시 개방', '국밥, 해장국', 95, 80, 1, true),
    forMembers: ['mem_02', 'mem_04'],
    reasons: [
      { memberId: 'mem_02', text: '탁 트인 바다에서 둘째 날을 시작해요.' },
      { memberId: 'mem_04', text: '늦게 시작해도 걷기 편한 해변이에요.' },
    ],
  },
  itm_05: {
    id: 'itm_05',
    startTime: '11:00',
    title: '청사포 다릿돌전망대',
    category: 'sightseeing',
    costPerPerson: 5000,
    moveFromPrev: move('bus', 20, 4200, 1550),
    place: place('plc_05', '청사포 다릿돌전망대', '부산 해운대구 중동', 35.1595, 129.192, '상시 개방', null, 60, 38, 0, false),
    forMembers: ['mem_04', 'mem_02'],
    reasons: [
      { memberId: 'mem_04', text: '한적하게 바다를 보며 쉬어 갈 수 있어요.' },
      { memberId: 'mem_02', text: '바다 위로 뻗은 전망대에서 사진을 남기기 좋아요.' },
    ],
  },
  itm_09: {
    id: 'itm_09',
    startTime: '12:30',
    title: '대변항 멸치회 점심',
    category: 'food',
    costPerPerson: 30000,
    moveFromPrev: move('bus', 35, 11500, 1750),
    place: place('plc_09', '대변항', '부산 기장군 기장읍 대변리', 35.2263, 129.2272, '10:00-21:00', '멸치회, 멸치쌈밥', 75, 55, 2, true),
    forMembers: ['mem_03', 'mem_01'],
    reasons: [
      { memberId: 'mem_03', text: '멸치회가 가성비 좋아요.' },
      { memberId: 'mem_01', text: '점심 시간에 맞춰 도착할 수 있어요.' },
    ],
  },
  itm_10: {
    id: 'itm_10',
    startTime: '14:00',
    title: '해동용궁사 산책',
    category: 'sightseeing',
    costPerPerson: 0,
    moveFromPrev: move('taxi', 10, 3800, 6500),
    place: place('plc_10', '해동용궁사', '부산 기장군 기장읍 용궁길 86', 35.1883, 129.2233, '05:00-19:00', null, 90, 76, 0, true),
    forMembers: ['mem_04', 'mem_01'],
    reasons: [
      { memberId: 'mem_04', text: '바다 옆 절에서 조용히 걸을 수 있어요.' },
      { memberId: 'mem_01', text: '대변항에서 가까워 이동이 짧아요.' },
    ],
  },
};

export const busanPlan: Plan = {
  id: 'pln_04',
  version: 4,
  status: 'confirmed',
  costPerPerson: 150000,
  budgetPerPerson: 250000,
  maxStepsPerDay: 6,
  satisfaction: [
    { memberId: 'mem_01', score: 8 },
    { memberId: 'mem_02', score: 9 },
    { memberId: 'mem_03', score: 8 },
    { memberId: 'mem_04', score: 9 },
  ],
  concessions: [{ memberId: 'mem_01', gave: '둘째 날 이른 출발', got: '동쪽 한 방향 동선' }],
  votes: [
    { memberId: 'mem_01', decision: 'approve' },
    { memberId: 'mem_02', decision: 'approve' },
    { memberId: 'mem_03', decision: 'approve' },
    { memberId: 'mem_04', decision: 'approve' },
  ],
  days: [
    {
      day: 1,
      date: '2026-11-14',
      items: [items.itm_01!, items.itm_02!, items.itm_04!, items.itm_08!, items.itm_07!, items.itm_03!],
    },
    { day: 2, date: '2026-11-15', items: [items.itm_06!, items.itm_05!, items.itm_09!, items.itm_10!] },
  ],
};
