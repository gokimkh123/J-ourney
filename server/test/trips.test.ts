import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { members } from '../src/db/schema.js';
import { hashToken } from '../src/lib/ids.js';
import { call, createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});

const createTrip = (nickname = '민수') => call(t.app, 'POST', '/trips', { title: '부산 1박 2일', nickname });
const join = (code: string, nickname: string) => call(t.app, 'POST', `/invites/${code}/join`, { nickname });

describe('POST /trips 여행 생성', () => {
  it('여행·방장·토큰을 만들어 201로 돌려줌', async () => {
    const res = await createTrip();
    expect(res.status).toBe(201);
    expect(res.body.trip).toMatchObject({ title: '부산 1박 2일', status: 'preparing' });
    expect(res.body.trip.id).toMatch(/^trp_[0-9a-z]{10}$/);
    expect(res.body.trip.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(res.body.member).toMatchObject({ nickname: '민수', color: '#F97316', isHost: true, personaReady: false, mbti: null });
    expect(res.body.member.id).toMatch(/^mem_[0-9a-z]{10}$/);
    expect(res.body.token).toMatch(/^tok_/);
  });

  it('토큰은 원문이 아니라 해시로만 저장함', async () => {
    const res = await createTrip();
    const [row] = await t.db.select().from(members).where(eq(members.id, res.body.member.id));
    expect(row.tokenHash).toBe(hashToken(res.body.token));
    expect(row.tokenHash).not.toContain(res.body.token);
  });

  it('닉네임이 비거나 본문이 JSON이 아니면 VALIDATION_ERROR(400)', async () => {
    const empty = await createTrip('  ');
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(empty.body.error.message).toContain('nickname');

    const res = await t.app.request('/api/v1/trips', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('여행 이름이 40자를 넘으면 VALIDATION_ERROR(400)', async () => {
    const long = await call(t.app, 'POST', '/trips', { title: '가'.repeat(41), nickname: '민수' });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toContain('40자');
  });
});

describe('초대·참여', () => {
  it('초대 정보는 인증 없이 보이고, 소문자 코드도 받음', async () => {
    const host = await createTrip();
    const res = await call(t.app, 'GET', `/invites/${host.body.trip.inviteCode.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.id).toBe(host.body.trip.id);
    expect(res.body.members).toHaveLength(1);
  });

  it('없는 초대 코드는 NOT_FOUND(404)', async () => {
    expect((await call(t.app, 'GET', '/invites/ZZZZZZ')).body.error.code).toBe('NOT_FOUND');
    expect((await join('ZZZZZZ', '지은')).status).toBe(404);
  });

  it('참여 순서대로 색을 배정하고, 방장 포함 4명이 차면 TRIP_FULL(409)', async () => {
    const host = await createTrip();
    const code = host.body.trip.inviteCode;
    const joined = [await join(code, '지은'), await join(code, '현우'), await join(code, '서연')];
    expect(joined.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(joined.map((r) => r.body.member.color)).toEqual(['#EC4899', '#0EA5E9', '#10B981']);
    expect(joined.every((r) => r.body.member.isHost === false)).toBe(true);

    const fifth = await join(code, '다섯째');
    expect(fifth.status).toBe(409);
    expect(fifth.body.error.code).toBe('TRIP_FULL');
  });

  it('동시에 참여 요청이 몰려도 4명을 넘지 않음', async () => {
    const host = await createTrip();
    const code = host.body.trip.inviteCode;
    const results = await Promise.all(['가', '나', '다', '라', '마'].map((n) => join(code, n)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.body.error?.code === 'TRIP_FULL')).toHaveLength(2);
  });
});

describe('GET /trips/{tripId} 여행 상세', () => {
  it('구성원과 상태를 돌려주고, 회의 조건은 아직 null', async () => {
    const host = await createTrip();
    await join(host.body.trip.inviteCode, '서연');
    const res = await call(t.app, 'GET', `/trips/${host.body.trip.id}`, undefined, host.body.token);
    expect(res.status).toBe(200);
    expect(res.body.trip.status).toBe('preparing');
    expect(res.body.members.map((m: { nickname: string }) => m.nickname)).toEqual(['민수', '서연']);
    expect(res.body.conditions).toBeNull();
  });

  it('토큰이 없거나 틀리면 401, 다른 여행이면 403, 없는 여행이면 404', async () => {
    const mine = await createTrip();
    const other = await createTrip('다른방장');
    const path = `/trips/${mine.body.trip.id}`;
    expect((await call(t.app, 'GET', path)).body.error.code).toBe('UNAUTHORIZED');
    expect((await call(t.app, 'GET', path, undefined, 'tok_wrong')).status).toBe(401);
    expect((await call(t.app, 'GET', path, undefined, other.body.token)).body.error.code).toBe('FORBIDDEN');
    expect((await call(t.app, 'GET', '/trips/trp_none', undefined, mine.body.token)).status).toBe(404);
  });
});

it('없는 경로는 오류 형식 그대로 NOT_FOUND(404)', async () => {
  const res = await call(t.app, 'GET', '/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
});
