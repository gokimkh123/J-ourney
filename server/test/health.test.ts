import { describe, expect, it } from 'vitest';
import { createApp, nowKst } from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('DB 없이도 200과 상태 ok를 돌려줌 (CI 이미지 확인용)', async () => {
    const res = await createApp({ db: null }).request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });

  it('DB가 없으면 다른 API는 INTERNAL_ERROR(500)', async () => {
    const res = await createApp({ db: null }).request('/api/v1/trips', { method: 'POST' });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
  });
});

describe('시험 화면 /dev/', () => {
  it('DEV_UI일 때만 제공함', async () => {
    const on = await createApp({ db: null, devUi: true }).request('/dev/');
    expect(on.status).toBe(200);
    expect(on.headers.get('Cache-Control')).toBe('no-store');
    expect((await createApp({ db: null }).request('/dev/')).status).toBe(404);
  });
});

describe('nowKst', () => {
  it('UTC 시각을 한국 시간으로 바꿈', () => {
    expect(nowKst(new Date('2026-10-13T12:00:00Z'))).toBe('2026-10-13T21:00:00+09:00');
  });
});
