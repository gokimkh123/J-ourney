import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routeCache } from '../db/schema.js';
import { tryConsumeTourCall } from '../tour/usage.js';
import type { Point } from './travel.js';

/**
 * 6단계 구간 길찾기 (카카오). 우리 계산식이 아니라 카카오가 준 결과를 그대로 씀 (10/23 사용자 결정: 시간표 대신 경로와 가는 길)
 * 대중교통·도보는 카카오맵 REST(무료 하루 각 1,000건), 자동차는 카카오모빌리티 길찾기(택시 요금 포함). 결제 수단은 연결하지 않음
 */
export const ROUTE = {
  /** 같은 구간을 다시 쓰는 날 수 (카카오 정책상 짧게만 보관) */
  cacheDays: 7,
  /** 저장 열쇠의 좌표 자릿수 (소수 넷째 자리 ≈ 11m, 같은 장소가 계산 중 조금 달라져도 같은 열쇠) */
  keyDigits: 4,
  /** 회의 한 번에 카카오를 실제로 부르는 상한 (저장된 결과는 세지 않음). 넘으면 그 구간은 '정보 없음'. 3일·하루 6곳 A·B가 처음이면 약 200번 */
  perMeeting: 300,
  /** 자동차 길찾기에서 출발·도착 지점 주변 도로의 교통 장애(유고)로 경로를 못 찾은 결과 코드. 잠깐의 일이라 '경로 없음'으로 저장하지 않음 (10/23 확인: 106 '도착 지점 주변의 도로에 유고 정보가 있음') */
  carIncidentCodes: [105, 106],
} as const;

export interface TransitLeg {
  minutes: number;
  distanceM: number;
  /** 요금(원). 카카오가 주지 않으면 null */
  fare: number | null;
  transfers: number;
  /** BUS · SUBWAY · BUS_AND_SUBWAY */
  type: string;
  /** 탈 노선 이름 (예: 1003, 2호선) */
  lines: string[];
  /** 카카오맵 길찾기 링크 */
  url: string | null;
}
export interface WalkLeg {
  minutes: number;
  distanceM: number;
  url: string | null;
}
export interface CarLeg {
  minutes: number;
  distanceM: number;
  taxiFare: number | null;
  toll: number | null;
}

/** 길찾기 호출기. null = 카카오가 '경로 없음'으로 답함 · 예외(RouteUnavailable) = 물어보지 못함(한도·오류·키 없음) */
export interface RouteClient {
  transit(a: Point, b: Point): Promise<TransitLeg | null>;
  walk(a: Point, b: Point): Promise<WalkLeg | null>;
  car(a: Point, b: Point): Promise<CarLeg | null>;
}

export class RouteUnavailable extends Error {}

type Fetch = typeof fetch;
const minutesOf = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const xy = (p: Point) => ({ x: p.lng, y: p.lat });

/**
 * 카카오 길찾기 호출기. beforeCall(기능)이 false면 부르지 않음 (하루 한도). 오류 문구에는 키를 넣지 않음
 * 대중교통은 카카오가 먼저 보여 주는 추천 경로(첫 경로)를 그대로 씀 — 가장 빠른 경로를 고르지 않음 (10/23 사용자 결정: 어느 정도 맞는 근사면 됨, 환승 적은 쪽이 현실적)
 * 대중교통 총시간(totalTime)에는 정류장까지 걷는 시간이 들어 있음 (구간 목록에는 없음, 10/23 시험 확인)
 */
export function kakaoRouter(opts: { restKey: string; mapBase: string; naviBase: string; timeoutMs: number; fetch?: Fetch; beforeCall?: (operation: string) => Promise<boolean> }): RouteClient {
  const doFetch = opts.fetch ?? fetch;
  async function get(operation: string, url: string): Promise<{ status: number; json: any }> {
    if (opts.beforeCall && !(await opts.beforeCall(operation))) throw new RouteUnavailable(`${operation} 하루 한도`);
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Authorization: `KakaoAK ${opts.restKey}` }, signal: AbortSignal.timeout(opts.timeoutMs) });
    } catch (err) {
      throw new RouteUnavailable(`${operation} 연결 실패: ${err instanceof Error ? err.name : 'error'}`);
    }
    const json = await res.json().catch(() => null);
    if (res.status === 429) throw new RouteUnavailable(`${operation} 카카오 무료 한도 초과`);
    if (!res.ok || !json) throw new RouteUnavailable(`${operation} HTTP ${res.status}`);
    return { status: res.status, json };
  }
  const query = (a: Point, b: Point) => {
    const s = xy(a);
    const e = xy(b);
    return new URLSearchParams({ start_x: String(s.x), start_y: String(s.y), end_x: String(e.x), end_y: String(e.y) }).toString();
  };
  return {
    async transit(a, b) {
      const { json } = await get('kakao/publictraffic', `${opts.mapBase}/v2/routing/publictraffic?${query(a, b)}`);
      if (json.status !== 'OK' || !json.routes?.length) return null;
      const route = json.routes[0];
      const p = route.properties ?? {};
      const lines = new Set<string>();
      for (const step of route.steps ?? []) for (const v of step.properties?.vehicles ?? []) if (v?.name) lines.add(String(v.name));
      return {
        minutes: minutesOf(Number(p.totalTime) || 0),
        distanceM: Number(p.totalDistance) || 0,
        fare: typeof p.fare?.value === 'number' ? p.fare.value : null,
        transfers: Number(p.transfers) || 0,
        type: String(p.type ?? ''),
        lines: [...lines].slice(0, 4),
        url: typeof json.properties?.landingURL === 'string' ? json.properties.landingURL : null,
      };
    },
    async walk(a, b) {
      const { json } = await get('kakao/walk', `${opts.mapBase}/v2/routing/walk?${query(a, b)}`);
      if (json.status !== 'OK' || !json.route) return null;
      const p = json.route.properties ?? {};
      return { minutes: minutesOf(Number(p.totalTime) || 0), distanceM: Number(p.totalDistance) || 0, url: typeof p.landingUrl === 'string' ? p.landingUrl : null };
    },
    async car(a, b) {
      const s = xy(a);
      const e = xy(b);
      const q = new URLSearchParams({ origin: `${s.x},${s.y}`, destination: `${e.x},${e.y}`, summary: 'true' }).toString();
      const { json } = await get('kakao/directions', `${opts.naviBase}/v1/directions?${q}`);
      const route = json.routes?.[0];
      if (route && (ROUTE.carIncidentCodes as readonly number[]).includes(route.result_code)) throw new RouteUnavailable(`kakao/directions 교통 장애 (${route.result_code})`);
      if (!route || route.result_code !== 0 || !route.summary) return null;
      const s2 = route.summary;
      return {
        minutes: minutesOf(Number(s2.duration) || 0),
        distanceM: Number(s2.distance) || 0,
        taxiFare: typeof s2.fare?.taxi === 'number' ? s2.fare.taxi : null,
        toll: typeof s2.fare?.toll === 'number' ? s2.fare.toll : null,
      };
    },
  };
}

/** 카카오 기능별 하루 호출 상한 (tour_api_usage 표에 기능 이름 kakao/…로 셈) */
export function kakaoQuota(db: Db, limits: { transit: number; walk: number; car: number }) {
  const limitOf: Record<string, number> = { 'kakao/publictraffic': limits.transit, 'kakao/walk': limits.walk, 'kakao/directions': limits.car };
  return (operation: string) => tryConsumeTourCall(db, operation, limitOf[operation] ?? 0);
}

const round = (v: number) => v.toFixed(ROUTE.keyDigits);
const at = (p: Point) => `${round(p.lat)},${round(p.lng)}`;
/** 자동차는 오가는 방향을 같은 구간으로 봄 (순서 비교용, 시간 차이가 작음). 대중교통·도보는 방향마다 따로 */
export function routeKey(mode: 'transit' | 'walk' | 'car', a: Point, b: Point): string {
  const [x, y] = mode === 'car' ? [at(a), at(b)].sort() : [at(a), at(b)];
  return `${mode}:${x}>${y}`;
}

/** 이 회의에서 카카오를 실제로 부른 수 (저장된 결과는 세지 않음) */
export interface RouteMeter {
  calls: { transit: number; walk: number; car: number };
  cached: number;
  unavailable: number;
}
export const newRouteMeter = (): RouteMeter => ({ calls: { transit: 0, walk: 0, car: 0 }, cached: 0, unavailable: 0 });

/**
 * 저장해 다시 쓰는 길찾기: ROUTE.cacheDays 안의 같은 구간은 카카오를 부르지 않음. 회의 한 번에 ROUTE.perMeeting번까지만 실제로 부름
 * inner가 null이면(키 없음) 저장된 결과만 쓰고 없으면 RouteUnavailable
 */
export function cachedRouter(db: Db, inner: RouteClient | null, meter: RouteMeter, now: () => Date = () => new Date()): RouteClient {
  const fresh = (fetchedAt: Date) => now().getTime() - fetchedAt.getTime() < ROUTE.cacheDays * 86400000;
  async function through<T>(mode: 'transit' | 'walk' | 'car', a: Point, b: Point, ask: (r: RouteClient) => Promise<T | null>): Promise<T | null> {
    const key = routeKey(mode, a, b);
    const [row] = await db.select().from(routeCache).where(eq(routeCache.key, key)).limit(1);
    if (row && fresh(row.fetchedAt)) {
      meter.cached++;
      return row.result as T | null;
    }
    const used = meter.calls.transit + meter.calls.walk + meter.calls.car;
    if (!inner || used >= ROUTE.perMeeting) {
      meter.unavailable++;
      throw new RouteUnavailable(inner ? '회의당 길찾기 상한' : '카카오 키 없음');
    }
    meter.calls[mode]++;
    try {
      const result = await ask(inner);
      await db
        .insert(routeCache)
        .values({ key, mode, result: result as never, fetchedAt: now() })
        .onConflictDoUpdate({ target: routeCache.key, set: { result: sql`excluded.result`, fetchedAt: sql`excluded.fetched_at` } });
      return result;
    } catch (err) {
      meter.unavailable++;
      throw err instanceof RouteUnavailable ? err : new RouteUnavailable(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    transit: (a, b) => through('transit', a, b, (r) => r.transit(a, b)),
    walk: (a, b) => through('walk', a, b, (r) => r.walk(a, b)),
    car: (a, b) => through('car', a, b, (r) => r.car(a, b)),
  };
}
