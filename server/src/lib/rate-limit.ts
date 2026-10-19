import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiError } from './errors.js';

const WINDOW_MS = 60_000;
const PRUNE_AT = 5000;

/**
 * 터널로 들어온 요청의 접속자 IP. 이 PC에서 직접 보낸 요청은 null
 * Cloudflare 헤더가 없어도 프록시 헤더(X-Forwarded-For)가 있으면 외부 요청으로 봄 (ngrok 등 다른 터널을 써도 막히게)
 */
export const tunnelIp = (c: Context) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

/** 터널 뒤에서는 Cloudflare가 넣어 주는 접속자 IP를 씀 */
const clientIp = (c: Context) =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

/** IP별 요청 제한: 쓰기 요청(POST·PUT)만 1분에 perMinute회까지 (조회는 제한하지 않음) */
export function writeRateLimit(perMinute: number) {
  const hits = new Map<string, { start: number; count: number }>();
  return createMiddleware(async (c, next) => {
    if (c.req.method !== 'POST' && c.req.method !== 'PUT') return next();
    const now = Date.now();
    if (hits.size > PRUNE_AT) for (const [ip, h] of hits) if (now - h.start >= WINDOW_MS) hits.delete(ip);
    const ip = clientIp(c);
    const h = hits.get(ip);
    if (!h || now - h.start >= WINDOW_MS) hits.set(ip, { start: now, count: 1 });
    else if (++h.count > perMinute) throw new ApiError('RATE_LIMITED', '요청이 너무 많음. 잠시 후 다시 시도');
    await next();
  });
}
