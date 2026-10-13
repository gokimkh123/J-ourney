import { describe, expect, it } from 'vitest';
import { app, nowKst } from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('200과 상태 ok를 돌려줌', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });
});

describe('nowKst', () => {
  it('UTC 시각을 한국 시간으로 바꿈', () => {
    expect(nowKst(new Date('2026-10-13T12:00:00Z'))).toBe('2026-10-13T21:00:00+09:00');
  });
});
