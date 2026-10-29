import { eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routeCache } from '../db/schema.js';
import { tryConsumeTourCall } from '../tour/usage.js';
import type { Point } from './travel.js';
import { DAY_MS } from '../lib/time.js';

/**
 * 6단계 구간 길찾기 (카카오). 우리 계산식이 아니라 카카오가 준 결과를 그대로 씀 (10/23 사용자 결정: 시간표 대신 경로와 가는 길)
 * 대중교통·도보는 카카오맵 REST(무료 하루 각 1,000건), 자동차는 카카오모빌리티 길찾기(택시 요금 포함). 결제 수단은 연결하지 않음
 */
export const ROUTE = {
  /** 같은 구간을 다시 쓰는 날 수 (카카오 정책상 짧게만 보관) */
  cacheDays: 7,
  /** 저장 열쇠의 좌표 자릿수 (소수 넷째 자리 ≈ 11m, 같은 장소가 계산 중 조금 달라져도 같은 열쇠) */
  keyDigits: 4,
  /**
   * 회의 한 번에 카카오를 실제로 부르는 상한 (저장된 결과는 세지 않음, 9단계 라운드까지 누적). 넘으면 그 구간은 '정보 없음'
   * 3일·하루 6곳 A·B가 처음이면 약 200번 + 9단계 수정 1건에 새 구간 약 10번(순서 비교 쌍·가는 길·끼니) × 라운드마다 최대 6건 × 4라운드 ≈ 240번 → 450 (10/29)
   */
  perMeeting: 450,
  /** 자동차 길찾기에서 출발·도착 지점 주변 도로의 교통 장애(유고)로 경로를 못 찾은 결과 코드. 잠깐의 일이라 '경로 없음'으로 저장하지 않음 (10/23 확인: 106 '도착 지점 주변의 도로에 유고 정보가 있음') */
  carIncidentCodes: [105, 106],
  /** 대중교통 구간에 보여 주는 노선 수 */
  linesShown: 4,
  /** 화면에 내보내는 길찾기 링크의 주소 (카카오가 준 링크라도 https의 이 주소가 아니면 버림, 10/26 저장분 95개 모두 map.kakao.com) */
  linkHosts: ['map.kakao.com', 'm.map.kakao.com'],
} as const;


/** 카카오가 준 길찾기 링크: https이고 ROUTE.linkHosts 주소일 때만 씀 (javascript: 같은 주소가 화면 링크로 들어가지 않게) */
export function kakaoLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (ROUTE.linkHosts as readonly string[]).includes(u.hostname) ? raw : null;
  } catch {
    return null;
  }
}

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
        lines: [...lines].slice(0, ROUTE.linesShown),
        url: kakaoLink(json.properties?.landingURL),
      };
    },
    async walk(a, b) {
      const { json } = await get('kakao/walk', `${opts.mapBase}/v2/routing/walk?${query(a, b)}`);
      if (json.status !== 'OK' || !json.route) return null;
      const p = json.route.properties ?? {};
      return { minutes: minutesOf(Number(p.totalTime) || 0), distanceM: Number(p.totalDistance) || 0, url: kakaoLink(p.landingUrl) };
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

/** 보관 날 수(ROUTE.cacheDays)가 지난 길찾기를 지움 (카카오 결과는 짧게만 보관, 매일 정리) */
export async function pruneRouteCache(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .delete(routeCache)
    .where(lt(routeCache.fetchedAt, new Date(now.getTime() - ROUTE.cacheDays * DAY_MS)))
    .returning({ key: routeCache.key });
  return rows.length;
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
 * 회의 안에서 같은 구간은 한 번만 읽거나 부름 (A·B안이 같은 구간을 동시에 물어도 같은 결과를 기다림, 못 쓴 구간도 다시 부르지 않음)
 * meter는 회의 전체의 누적 수 (9단계가 라운드마다 새로 만들어도 회의당 상한이 이어지게), failed는 이 회의에서 못 쓴 구간 (저장하지 않는 교통 장애·한도 등,
 * 라운드마다 다시 짤 때 같은 구간을 다시 부르지 않게 회의 상태에 이어서 둠, 10/29)
 */
export function cachedRouter(db: Db, inner: RouteClient | null, meter: RouteMeter, now: () => Date = () => new Date(), failed: Set<string> = new Set()): RouteClient {
  const fresh = (fetchedAt: Date) => now().getTime() - fetchedAt.getTime() < ROUTE.cacheDays * DAY_MS;
  const seen = new Map<string, { job: Promise<unknown>; at: Date }>();
  function through<T>(mode: 'transit' | 'walk' | 'car', a: Point, b: Point, ask: (r: RouteClient) => Promise<T | null>): Promise<T | null> {
    const key = routeKey(mode, a, b);
    const hit = seen.get(key);
    // 다시 물으면 저장된 결과를 쓴 것으로 셈 (예전처럼 DB에서 다시 읽은 것과 같은 수)
    if (hit && fresh(hit.at))
      return hit.job.then(
        (result) => {
          meter.cached++;
          return result as T | null;
        },
        (err) => {
          meter.unavailable++;
          throw err;
        },
      );
    const job = lookup(key, mode, ask);
    seen.set(key, { job, at: now() });
    return job;
  }
  async function lookup<T>(key: string, mode: 'transit' | 'walk' | 'car', ask: (r: RouteClient) => Promise<T | null>): Promise<T | null> {
    const [row] = await db.select().from(routeCache).where(eq(routeCache.key, key)).limit(1);
    if (row && fresh(row.fetchedAt)) {
      meter.cached++;
      return row.result as T | null;
    }
    // 이 회의에서 못 쓴 구간은 카카오를 다시 부르지 않음 (그 사이 다른 회의가 저장해 두었으면 위에서 저장된 것을 씀)
    if (failed.has(key)) {
      meter.unavailable++;
      throw new RouteUnavailable('이 회의에서 이미 못 쓴 구간');
    }
    const used = meter.calls.transit + meter.calls.walk + meter.calls.car;
    if (!inner || used >= ROUTE.perMeeting) {
      meter.unavailable++;
      failed.add(key);
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
      failed.add(key);
      throw err instanceof RouteUnavailable ? err : new RouteUnavailable(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    transit: (a, b) => through('transit', a, b, (r) => r.transit(a, b)),
    walk: (a, b) => through('walk', a, b, (r) => r.walk(a, b)),
    car: (a, b) => through('car', a, b, (r) => r.car(a, b)),
  };
}
