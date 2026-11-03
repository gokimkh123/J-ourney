// 가짜 서버의 커뮤니티 예시(부산). 이름은 실제 명소지만 AI가 고른 수·별점·후기는 설명용 예시다.

type Seed = { id: string; name: string; group: string; category: string; address: string; lat: number; lng: number; aiPicks: number; hours: string | null; openNow: boolean | null; overview: string };

export const MOCK_COMMUNITY_REGION = { code: '26', name: '부산광역시' } as const;

export const MOCK_COMMUNITY_PLACES: Seed[] = [
  { id: 'plc_m101', name: '영도 돼지국밥', group: '음식', category: '한식', address: '부산광역시 영도구 태종로 [주소]', lat: 35.0911, lng: 129.0679, aiPicks: 42, hours: '09:00–21:00', openNow: true, overview: '[예시 소개] 영도 바닷가 근처의 돼지국밥집이에요.' },
  { id: 'plc_m102', name: '해운대 밀면', group: '음식', category: '한식', address: '부산광역시 해운대구 [주소]', lat: 35.1631, lng: 129.1635, aiPicks: 37, hours: '10:30–20:00', openNow: false, overview: '[예시 소개] 해운대 시장 근처의 밀면집이에요.' },
  { id: 'plc_m103', name: '남포동 씨앗호떡', group: '음식', category: '간식', address: '부산광역시 중구 [주소]', lat: 35.0987, lng: 129.0286, aiPicks: 29, hours: null, openNow: null, overview: '[예시 소개] 남포동 거리의 호떡 노점이에요.' },
  { id: 'plc_m201', name: '태종대', group: '자연', category: '공원', address: '부산광역시 영도구 전망로 24', lat: 35.0532, lng: 129.0873, aiPicks: 51, hours: '04:00–24:00', openNow: true, overview: '[예시 소개] 영도 남쪽 끝 바닷가 절벽을 따라 숲길과 전망대가 이어진 공원이에요.<br>순환 열차로 한 바퀴 돌 수 있어요.' },
  { id: 'plc_m202', name: '이기대 해안산책로', group: '자연', category: '산책로', address: '부산광역시 남구 용호동 [주소]', lat: 35.1206, lng: 129.1232, aiPicks: 44, hours: null, openNow: null, overview: '[예시 소개] 바다를 따라 걷는 해안 산책로예요.' },
  { id: 'plc_m203', name: '해운대 해수욕장', group: '자연', category: '해변', address: '부산광역시 해운대구 우동 [주소]', lat: 35.1587, lng: 129.1604, aiPicks: 40, hours: null, openNow: null, overview: '[예시 소개] 부산을 대표하는 해변이에요.' },
  { id: 'plc_m301', name: '감천문화마을', group: '문화관광', category: '마을', address: '부산광역시 사하구 감내2로 203', lat: 35.0975, lng: 129.0106, aiPicks: 38, hours: '09:00–18:00', openNow: true, overview: '[예시 소개] 산비탈에 알록달록한 집이 모인 마을이에요.' },
  { id: 'plc_m302', name: '흰여울문화마을', group: '문화관광', category: '마을', address: '부산광역시 영도구 영선동 [주소]', lat: 35.0781, lng: 129.0446, aiPicks: 33, hours: null, openNow: null, overview: '[예시 소개] 바다를 내려다보는 절벽 위 골목 마을이에요.' },
  { id: 'plc_m303', name: 'BIFF 광장', group: '문화관광', category: '거리', address: '부산광역시 중구 남포동 [주소]', lat: 35.0989, lng: 129.0275, aiPicks: 30, hours: null, openNow: null, overview: '[예시 소개] 영화제의 흔적이 남은 거리예요.' },
];

/** 처음부터 있는 예시 후기 [장소, 닉네임, 별점, 글, 날짜] */
export const MOCK_COMMUNITY_REVIEWS: [string, string, number, string, string][] = [
  ['plc_m201', '지은', 5, '[후기 예시] 열차 타고 전망대까지 갔는데 바다가 정말 넓게 보였어요.', '2026-10-28T15:20:00+09:00'],
  ['plc_m201', '현우', 4, '[후기 예시] 걷는 길이 꽤 길어서 편한 신발이 좋아요.', '2026-10-25T11:02:00+09:00'],
  ['plc_m101', '서연', 5, '', '2026-10-30T12:40:00+09:00'],
];
