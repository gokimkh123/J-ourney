import { eq, inArray } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { Db } from '../db/client.js';
import { llmUsage, meetings } from '../db/schema.js';
import { ipKey } from '../llm/usage.js';
import { tourCallsByOperation } from '../tour/usage.js';
import { type AccessKey, accessOf } from './access.js';
import { tunnelIp } from './rate-limit.js';
import { nowKst, todayKst } from './time.js';

/**
 * 관리자 디버깅 화면(/dev/monitor) 규칙 값 (10/29 사용자 "터미널로 하지 말고 관리자 전용 디버깅 툴")
 * 기록은 서버 메모리에만 두고 DB에 쓰지 않음 (서버를 다시 켜면 비워짐). 토큰·초대 코드·접근 키·IP 원문은 두지 않음
 */
export const MONITOR = {
  /** 메모리에 두는 최근 요청 수 · WebSocket 사건 수 */
  requests: 500,
  sockets: 200,
  /** 분당 횟수를 보여 주는 시간 (분) */
  minutes: 10,
  /** 기기를 가르는 짧은 표시 (IP를 비밀값으로 HMAC한 앞부분, IP 원문은 두지 않음) */
  clientChars: 6,
  /** 초대 코드는 앞 몇 글자만 보임 */
  codeShown: 2,
  /**
   * 1분에 따로 세는 묶음 주소 수 · 기록에 남기는 주소 길이 (11/2 보안 점검: 아무 주소나 길게 보내면 분당 묶음이 끝없이 늘어 메모리가 참)
   * 넘는 묶음은 '그 밖'으로 셈. 앱이 쓰는 경로는 30개 안팎
   */
  routesPerMinute: 100,
  pathChars: 200,
} as const;

/** 분당 묶음 상한을 넘거나 없는 주소(404)인 요청을 세는 묶음 */
const OTHER_ROUTE = '(그 밖)';

/** 기록하지 않는 주소 (이 화면이 2초마다 묻는 것·그림·컨테이너 상태 확인) */
const SKIP = [/^\/dev\/monitor/, /^\/dev\/img\//, /^\/api\/v1\/health$/];

export interface RequestEntry {
  at: string;
  method: string;
  /** 토큰·키는 ***, 초대 코드는 앞 두 글자만 */
  path: string;
  /** id를 묶음 이름으로 바꾼 주소 (분당 횟수용) */
  route: string;
  status: number;
  ms: number;
  /** 로컬 · 키 team · 키 없음 */
  who: string;
  client: string;
}

export interface SocketEntry {
  at: string;
  event: 'open' | 'close';
  tripId: string;
  memberId: string;
  /** 연결할 때 받은 번호 (이 번호 뒤의 이벤트부터 받음) */
  afterSeq?: number;
  /** 닫힌 까닭 (WebSocket 닫힘 코드·글) */
  code?: number;
  reason?: string;
  /** 열려 있던 시간 (초) · 보낸 글 수 (ping 포함) */
  seconds?: number;
  sent?: number;
  who: string;
  client: string;
}

/** 주소의 토큰·키 값은 가리고 초대 코드는 앞부분만 (관리자 화면에도 원문을 두지 않음) */
export function maskPath(url: string): string {
  const u = new URL(url, 'http://local');
  for (const k of [...u.searchParams.keys()]) if (/token|key/i.test(k)) u.searchParams.set(k, '***');
  const path = u.pathname.replace(/(\/invites\/)([^/]+)/, (_all, head: string, code: string) => `${head}${code.slice(0, MONITOR.codeShown)}****`);
  const query = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).join('&');
  return (query ? `${path}?${query}` : path).slice(0, MONITOR.pathChars);
}

/** 주소의 id를 묶음 이름으로 (분당 횟수용): trp_… → :tripId, mtg_… → :meetingId, mem_… → :memberId, 초대 코드 → :code */
export const routeOf = (path: string) =>
  path
    .replace(/\?.*$/, '')
    .replace(/trp_[A-Za-z0-9]+/g, ':tripId')
    .replace(/mtg_[A-Za-z0-9]+/g, ':meetingId')
    .replace(/mem_[A-Za-z0-9]+/g, ':memberId')
    .replace(/plc_[A-Za-z0-9_-]+/g, ':placeId')
    .replace(/itm_[A-Za-z0-9_-]+/g, ':itemId')
    .replace(/(\/invites\/)[^/]+/, '$1:code');

const push = <T>(list: T[], item: T, max: number) => {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
};

export type Monitor = ReturnType<typeof createMonitor>;

/** 요청·WebSocket 기록을 메모리에 모음. middleware는 앱 맨 앞에 붙임 */
export function createMonitor(opts: { accessKeys: readonly AccessKey[]; ipSecret: string }) {
  const requests: RequestEntry[] = [];
  const sockets: SocketEntry[] = [];
  /** 분(KST, YYYY-MM-DDTHH:MM) → 묶음 주소 → 횟수 */
  const perMinute = new Map<string, Map<string, number>>();
  const whoOf = (c: Context) => {
    const a = accessOf(c, opts.accessKeys);
    return a.kind === 'key' ? `키 ${a.label}` : a.kind === 'local' ? '로컬' : '키 없음';
  };
  const clientOf = (c: Context) => {
    const ip = tunnelIp(c);
    return ip === null ? '로컬' : `기기 ${ipKey(ip, opts.ipSecret).slice(0, MONITOR.clientChars)}`;
  };
  const count = (route: string) => {
    const minute = nowKst().slice(0, 16);
    const m = perMinute.get(minute) ?? new Map<string, number>();
    const key = m.has(route) || m.size < MONITOR.routesPerMinute ? route : OTHER_ROUTE;
    m.set(key, (m.get(key) ?? 0) + 1);
    perMinute.set(minute, m);
    for (const k of [...perMinute.keys()].sort().slice(0, -MONITOR.minutes)) perMinute.delete(k);
  };

  const middleware: MiddlewareHandler = async (c, next) => {
    const started = performance.now();
    await next();
    const url = new URL(c.req.url);
    if (SKIP.some((re) => re.test(url.pathname))) return;
    const path = maskPath(`${url.pathname}${url.search}`);
    // 없는 주소(404)는 한 묶음으로 (주소마다 묶음을 만들지 않음)
    const route = c.res.status === 404 ? OTHER_ROUTE : `${c.req.method} ${routeOf(url.pathname).slice(0, MONITOR.pathChars)}`;
    push(requests, { at: nowKst(), method: c.req.method, path, route, status: c.res.status, ms: Math.round(performance.now() - started), who: whoOf(c), client: clientOf(c) }, MONITOR.requests);
    count(route);
  };

  /** WebSocket이 열림: 닫힐 때 부를 함수를 돌려줌 (보낸 글 수는 sent()로 셈) */
  const socketOpened = (c: Context, info: { tripId: string; memberId: string; afterSeq: number }) => {
    const opened = Date.now();
    const base = { tripId: info.tripId, memberId: info.memberId, who: whoOf(c), client: clientOf(c) };
    push(sockets, { at: nowKst(), event: 'open', afterSeq: info.afterSeq, ...base }, MONITOR.sockets);
    let sent = 0;
    return {
      sent: () => {
        sent++;
      },
      closed: (code?: number, reason?: string) => push(sockets, { at: nowKst(), event: 'close', code, reason: reason || undefined, seconds: Math.round((Date.now() - opened) / 1000), sent, ...base }, MONITOR.sockets),
    };
  };

  const snapshot = () => ({
    requests: [...requests].reverse(),
    sockets: [...sockets].reverse(),
    perMinute: [...perMinute.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([minute, m]) => ({ minute: minute.slice(11), routes: Object.fromEntries(m) })),
  });

  return { middleware, socketOpened, snapshot };
}

/** 화면 맨 위 숫자: 오늘 AI·외부 API 호출 수(서버가 세는 하루 횟수표), 진행 중인 회의 */
export async function monitorStats(db: Db) {
  const day = todayKst();
  const [llm] = await db.select({ count: llmUsage.count }).from(llmUsage).where(eq(llmUsage.day, day));
  const live = await db
    .select({ id: meetings.id, tripId: meetings.tripId, status: meetings.status, startedAt: meetings.startedAt, llmCalls: meetings.llmCalls })
    .from(meetings)
    .where(inArray(meetings.status, ['running', 'reviewing']));
  return {
    now: nowKst(),
    llmToday: llm?.count ?? 0,
    apisToday: await tourCallsByOperation(db, day),
    meetings: live.map((m) => ({ ...m, startedAt: nowKst(m.startedAt) })),
  };
}
