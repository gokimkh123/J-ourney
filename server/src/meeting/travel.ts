/**
 * 이동 시간 어림 (좌표만 씀, 외부 API 0회). 확정 때는 카카오 길찾기로 확인함
 * 값은 10/17 회의 시험(5–13단계 시험 버전 750여 회의)에 쓴 시험값이며 6단계 정식 구현 때 확정함
 */
export const TRAVEL = {
  /** 직선거리 → 실제 길 (곱) */
  detour: 1.3,
  /** 이 거리(km)까지는 걸어감 */
  walkMaxKm: 1,
  walkKmh: 4.5,
  /** 대중교통: 처음 cityKm까지는 시내 속도, 그 뒤는 시외(고속·시외버스) 속도, 기다림·갈아타기 분 */
  cityKm: 10,
  cityKmh: 18,
  intercityKmh: 45,
  transitWaitMinutes: 10,
} as const;

export interface Point {
  lat: number;
  lng: number;
}

/** 두 점 사이 직선거리(km), 짧은 거리용 근사 */
export function distanceKm(a: Point, b: Point): number {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return 6371 * Math.hypot(x, y);
}

/** 편도 이동 분: walkMaxKm 안은 걷고, 그보다 멀면 대중교통 */
export function oneWayMinutes(a: Point, b: Point): number {
  const km = distanceKm(a, b) * TRAVEL.detour;
  if (km <= TRAVEL.walkMaxKm) return Math.round((km / TRAVEL.walkKmh) * 60);
  const city = Math.min(km, TRAVEL.cityKm);
  return Math.round((city / TRAVEL.cityKmh) * 60 + ((km - city) / TRAVEL.intercityKmh) * 60 + TRAVEL.transitWaitMinutes);
}

/** 좌표가 있는 점들의 가운데 (없으면 null) */
export function centerOf(points: readonly { lat: number | null; lng: number | null }[]): Point | null {
  const xs = points.filter((p): p is Point => p.lat !== null && p.lng !== null);
  if (!xs.length) return null;
  return { lat: xs.reduce((s, p) => s + p.lat, 0) / xs.length, lng: xs.reduce((s, p) => s + p.lng, 0) / xs.length };
}
