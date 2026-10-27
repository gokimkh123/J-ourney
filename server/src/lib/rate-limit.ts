import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiError } from './errors.js';

const WINDOW_MS = 60_000;
const PRUNE_AT = 5000;

/**
 * 터널로 들어온 요청의 접속자 IP. 이 PC에서 직접 보낸 요청은 null
 * Cloudflare 헤더가 없어도 프록시 헤더(X-Forwarded-For)가 있으면 외부 요청으로 봄 (ngrok 등 다른 터널을 써도 막히게)
 * 헤더가 있는데 비어 있으면 IP를 알 수 없는 외부 요청으로 봄 (빈 값으로 서버 안 요청처럼 보이지 않게)
 */
export const tunnelIp = (c: Context): string | null => {
  const cf = c.req.header('cf-connecting-ip');
  const xff = c.req.header('x-forwarded-for');
  if (cf === undefined && xff === undefined) return null;
  return cf?.trim() || xff?.split(',')[0]?.trim() || 'unknown';
};

/** 터널 뒤에서는 Cloudflare가 넣어 주는 접속자 IP를 씀 */
const clientIp = (c: Context) => tunnelIp(c) ?? 'local';

/** 1분 창으로 IP마다 횟수를 셈 (오래된 IP는 PRUNE_AT개를 넘을 때 지움) */
function perMinuteCounter() {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    /** 이번 창의 횟수 (지난 창이면 0) */
    count(ip: string, now = Date.now()) {
      const h = hits.get(ip);
      return h && now - h.start < WINDOW_MS ? h.count : 0;
    },
    /** 1 올리고 이번 창의 횟수를 돌려줌 */
    add(ip: string, now = Date.now()) {
      if (hits.size > PRUNE_AT) for (const [k, h] of hits) if (now - h.start >= WINDOW_MS) hits.delete(k);
      const h = hits.get(ip);
      if (!h || now - h.start >= WINDOW_MS) {
        hits.set(ip, { start: now, count: 1 });
        return 1;
      }
      return ++h.count;
    },
  };
}

/** IP별 요청 제한: 쓰기 요청(POST·PUT)만 1분에 perMinute회까지 (조회는 제한하지 않음) */
export function writeRateLimit(perMinute: number) {
  const hits = perMinuteCounter();
  return createMiddleware(async (c, next) => {
    if (c.req.method !== 'POST' && c.req.method !== 'PUT') return next();
    if (hits.add(clientIp(c)) > perMinute) throw new ApiError('RATE_LIMITED', '요청이 너무 많음. 잠시 후 다시 시도');
    await next();
  });
}

/**
 * IP별 실패 제한: 1분에 perMinute번 실패한 IP는 그 창이 끝날 때까지 막음 (초대 코드 맞추기 방지)
 * 맞는 코드로 자주 조회하는 화면(앱 대기실이 3초마다 조회)은 실패가 없어 막히지 않음
 */
export function failureLimit(perMinute: number) {
  const fails = perMinuteCounter();
  return {
    check(c: Context) {
      if (fails.count(clientIp(c)) >= perMinute) throw new ApiError('RATE_LIMITED', '잘못된 요청이 너무 많음. 잠시 후 다시 시도');
    },
    fail(c: Context) {
      fails.add(clientIp(c));
    },
  };
}
