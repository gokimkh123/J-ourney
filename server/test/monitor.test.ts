import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { describe, expect, it } from 'vitest';
import { MONITOR, maskPath, routeOf } from '../src/lib/monitor.js';
import { LIVE, liveSocketServer } from '../src/meeting/live.js';
import { call, createTestApp } from './helpers.js';

const tunnel = { 'cf-connecting-ip': '203.0.113.9' };

describe('관리자 디버깅 화면 (/dev/monitor, 10/29)', () => {
  it('주소의 토큰·키는 가리고 초대 코드는 앞 두 글자만, 분당 횟수는 id를 묶음 이름으로 셈', () => {
    expect(maskPath('/api/v1/trips/trp_abc/ws?token=tok_secret&afterSeq=0')).toBe('/api/v1/trips/trp_abc/ws?token=***&afterSeq=0');
    expect(maskPath('/dev/key?key=abc')).toBe('/dev/key?key=***');
    expect(maskPath('/api/v1/invites/PTF76N/join')).toBe(`/api/v1/invites/PT****/join`);
    expect(routeOf('/api/v1/trips/trp_9r3clqfb8c/ws')).toBe('/api/v1/trips/:tripId/ws');
    expect(routeOf('/api/v1/meetings/mtg_1/review')).toBe('/api/v1/meetings/:meetingId/review');
    expect(routeOf('/api/v1/invites/PTF76N')).toBe('/api/v1/invites/:code');
    expect(MONITOR.requests).toBeGreaterThan(0);
  });

  it('서버 컴퓨터(로컬)에서만 열리고 터널로는 팀 키가 있어도 403 · 요청 기록에 토큰·초대 코드 원문이 없음 · WebSocket 열림·닫힘과 닫힌 까닭을 남김', async () => {
    const { app } = await createTestApp({ devUi: true, livePingMs: 60_000 });
    expect((await app.request('/dev/monitor')).status).toBe(200);
    expect((await app.request('/dev/monitor/data', { headers: tunnel })).status).toBe(403);
    expect((await app.request('/dev/monitor', { headers: tunnel })).status).toBe(403);

    const demo = await call(app, 'POST', '/trips', { title: '모니터 시험', nickname: '민수', demoMode: true });
    const token = demo.body.token as string;
    const tripId = demo.body.trip.id as string;
    const code = demo.body.trip.inviteCode as string;
    await call(app, 'GET', `/invites/${code}`);
    await call(app, 'GET', `/invites/${code}`, undefined, undefined, tunnel);

    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: liveSocketServer() } }, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    const open = () =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/trips/${tripId}/ws?token=${token}&afterSeq=0`);
        ws.onopen = () => resolve(ws);
        ws.onerror = reject;
      });
    const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    try {
      // 한 사람이 연결을 상한(2개)보다 많이 열면 가장 오래된 연결이 4000으로 밀려남 — 앱이 매번 새로 여는지 이 기록으로 보임
      const sockets = [];
      for (let i = 0; i < LIVE.perMember + 1; i++) sockets.push(await open());
      expect(await closed(sockets[0])).toBe(4000);
      for (const ws of sockets.slice(1)) ws.close();
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      server.close();
    }

    const res = await app.request('/dev/monitor/data');
    const data = await res.json();
    const text = JSON.stringify(data);
    expect(text).not.toContain(token);
    expect(text).not.toContain(code);
    expect(data.requests.some((r: { route: string; who: string }) => r.route === 'GET /api/v1/invites/:code' && r.who === '키 없음')).toBe(true);
    expect(data.requests.some((r: { client: string }) => r.client.startsWith('기기 '))).toBe(true); // 터널 요청은 IP 대신 짧은 표시
    expect(data.requests.every((r: { path: string }) => !r.path.startsWith('/dev/monitor'))).toBe(true); // 이 화면이 묻는 것은 남기지 않음
    const events = data.sockets as { event: string; code?: number; afterSeq?: number; tripId: string }[];
    expect(events.filter((e) => e.event === 'open')).toHaveLength(LIVE.perMember + 1);
    expect(events.some((e) => e.event === 'close' && e.code === 4000)).toBe(true);
    expect(events.every((e) => e.tripId === tripId)).toBe(true);
    expect(data.perMinute.at(-1).routes['GET /api/v1/invites/:code']).toBe(2);
    expect(data).toMatchObject({ llmToday: 0, meetings: [] });
  });
});
