// 커뮤니티(명세 v2.4 4.7, 화면 E1): AI가 회의에서 많이 고른 장소 + 여행자 후기.

export type CommunityPlace = {
  placeId: string;
  name: string;
  /** 관광공사 공식 대분류(음식·자연·문화관광…), 없으면 '기타' */
  group: string;
  category: string | null;
  imageUrl: string | null;
  /** 사진 출처(공공누리, 관광공사 사진이면 '한국관광공사') */
  imageCredit: string | null;
  address: string | null;
  lat: number;
  lng: number;
  /** 회의에서 AI가 고른 수 */
  aiPicks: number;
  rating: { average: number | null; count: number };
  /** 지금 여는지: 쉬는 날이면 false, 모르면 null */
  openNow: boolean | null;
  hours: string | null;
};

export type CommunitySection = { group: string; aiPicks: number; places: CommunityPlace[] };

export type CommunityList = { regionCode: string | null; regionName: string | null; sections: CommunitySection[] };

export type CommunityReview = {
  reviewId: string;
  nickname: string;
  rating: number;
  text: string;
  /** 보낸 구성원 토큰의 사람이 쓴 후기 */
  mine: boolean;
  updatedAt: string;
};

export type CommunityPlaceDetail = { place: CommunityPlace & { overview: string | null }; reviews: CommunityReview[] };

/** 시·도(법정동 2자리, 서버 regions와 같은 코드). 순서는 고르기 화면 순서 */
export const REGIONS: readonly { code: string; name: string }[] = [
  { code: '11', name: '서울' },
  { code: '26', name: '부산' },
  { code: '27', name: '대구' },
  { code: '28', name: '인천' },
  { code: '29', name: '광주' },
  { code: '30', name: '대전' },
  { code: '31', name: '울산' },
  { code: '36', name: '세종' },
  { code: '41', name: '경기' },
  { code: '51', name: '강원' },
  { code: '43', name: '충북' },
  { code: '44', name: '충남' },
  { code: '52', name: '전북' },
  { code: '46', name: '전남' },
  { code: '47', name: '경북' },
  { code: '48', name: '경남' },
  { code: '50', name: '제주' },
];

export function regionName(code: string | null): string {
  return code === null ? '전국' : (REGIONS.find((r) => r.code === code)?.name ?? '전국');
}

/** 리뷰 글 길이 상한(서버와 같음) */
export const REVIEW_TEXT_MAX = 300;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parsePlace(v: unknown): CommunityPlace | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const placeId = str(o.placeId);
  const name = str(o.name);
  if (placeId === null || name === null) return null;
  const r = (typeof o.rating === 'object' && o.rating !== null ? o.rating : {}) as Record<string, unknown>;
  return {
    placeId,
    name,
    group: str(o.group) ?? '기타',
    category: str(o.category),
    imageUrl: str(o.imageUrl),
    imageCredit: str(o.imageCredit),
    address: str(o.address),
    lat: num(o.lat) ?? 0,
    lng: num(o.lng) ?? 0,
    aiPicks: num(o.aiPicks) ?? 0,
    rating: { average: num(r.average), count: num(r.count) ?? 0 },
    openNow: typeof o.openNow === 'boolean' ? o.openNow : null,
    hours: str(o.hours),
  };
}

/** GET /community/places. 모양이 다른 장소·묶음은 건너뛰고, 장소가 없는 묶음은 뺀다. */
export function parseCommunityList(json: unknown): CommunityList {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const sections: CommunitySection[] = [];
  for (const s of Array.isArray(o.sections) ? o.sections : []) {
    if (typeof s !== 'object' || s === null) continue;
    const so = s as Record<string, unknown>;
    const places = (Array.isArray(so.places) ? so.places : []).map(parsePlace).filter((p): p is CommunityPlace => p !== null);
    if (places.length === 0) continue;
    sections.push({ group: str(so.group) ?? '기타', aiPicks: num(so.aiPicks) ?? 0, places });
  }
  return { regionCode: str(o.regionCode), regionName: str(o.regionName), sections };
}

export function parseReview(v: unknown): CommunityReview | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const reviewId = str(o.reviewId);
  const rating = num(o.rating);
  if (reviewId === null || rating === null) return null;
  return { reviewId, nickname: str(o.nickname) ?? '', rating, text: str(o.text) ?? '', mine: o.mine === true, updatedAt: str(o.updatedAt) ?? str(o.createdAt) ?? '' };
}

/** GET /community/places/{placeId} */
export function parseCommunityPlace(json: unknown): CommunityPlaceDetail {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const place = parsePlace(o.place);
  if (place === null) throw new Error('장소 응답 모양이 올바르지 않습니다.');
  const overview = str((o.place as Record<string, unknown>).overview);
  const reviews = (Array.isArray(o.reviews) ? o.reviews : []).map(parseReview).filter((r): r is CommunityReview => r !== null);
  return { place: { ...place, overview }, reviews };
}

/** 주소에서 구·군 이름(두 번째 낱말: "부산광역시 해운대구 …" → "해운대구"). 세종처럼 없으면 null */
export function districtOf(address: string | null): string | null {
  const parts = (address ?? '').trim().split(/\s+/);
  const d = parts[1];
  return d !== undefined && /[시군구]$/.test(d) ? d : null;
}

/** 목록에 나온 구·군 이름(가나다순). 장소가 있는 곳만 고를 수 있게 한다. */
export function districtsOf(list: CommunityList): string[] {
  const set = new Set<string>();
  for (const s of list.sections) for (const p of s.places) {
    const d = districtOf(p.address);
    if (d !== null) set.add(d);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 구·군으로 거른 목록. null이면 그대로. 장소가 없어진 묶음은 뺀다. */
export function filterByDistrict(list: CommunityList, district: string | null): CommunityList {
  if (district === null) return list;
  const sections = list.sections
    .map((s) => ({ ...s, places: s.places.filter((p) => districtOf(p.address) === district) }))
    .filter((s) => s.places.length > 0)
    .map((s) => ({ ...s, aiPicks: s.places.reduce((a, p) => a + p.aiPicks, 0) }));
  return { ...list, sections };
}

/** 별점 문장: 1~5점 */
export function ratingWord(rating: number): string {
  return ['', '별로였어요', '아쉬웠어요', '괜찮았어요', '좋았어요', '최고였어요'][rating] ?? '';
}

/** 후기 날짜: "2026-10-28T…" → "10월 28일" */
export function reviewDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : '';
}

/** 관광공사 소개글의 줄바꿈 태그를 빼고 줄로 바꾼다. */
export function plainOverview(text: string | null): string | null {
  if (text === null) return null;
  const out = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return out === '' ? null : out;
}

/** 카카오맵에서 이 장소 보기(앱 키 없이 쓰는 공개 링크) */
export function kakaoMapUrl(place: Pick<CommunityPlace, 'name' | 'lat' | 'lng'>): string {
  return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}
