import { Hono } from 'hono';

/** 한국 시간(+09:00) ISO 8601 문자열 (명세서 3장 공통 규칙) */
export function nowKst(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

export const app = new Hono().basePath('/api/v1');

// 서버 연결 확인 (인증 불필요, 명세서 4.1)
app.get('/health', (c) => c.json({ status: 'ok', time: nowKst() }));
