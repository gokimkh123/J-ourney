import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import { ApiError } from './errors.ts';
import { MOCK_QUESTIONS } from './mockQuestions.ts';
import type { Persona, SessionResponse, SubmitAnswer } from '../persona/types.ts';

type Call = { url: string; init?: Parameters<FetchLike>[1] };

function setup(status: number, body: unknown): { endpoints: ReturnType<typeof createEndpoints>; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  const client = createApiClient({ baseUrl: 'http://host', fetchFn, getToken: () => 'tok' });
  return { endpoints: createEndpoints(client), calls };
}

const session: SessionResponse = {
  trip: { id: 'trp_1', title: '부산 여행', inviteCode: 'BSN482', status: 'preparing' },
  member: {
    id: 'mem_01',
    nickname: '민수',
    color: '#F97316',
    isHost: true,
    personaReady: false,
    title: null,
  },
  token: 'tok_mem_01_ABC123',
};

const persona: Persona = {
  memberId: 'mem_01',
  nickname: '민수',
  color: '#F97316',
  no: 1,
  title: '꼼꼼한 플래너',
  catchphrase: '일정표는 제가 챙길게요!',
  tmi: '여행 체크리스트가 세 장 넘음',
  chips: [{ label: '계획형', emoji: '📋' }],
  traits: [
    { key: 'plan', name: '계획', score: 10, level: 'high', label: '계획형', emoji: '📋' },
    { key: 'pace', name: '속도', score: 5, level: 'neutral', label: '상관없음', emoji: '' },
    { key: 'vibe', name: '분위기', score: 2, level: 'low', label: '한적형', emoji: '🌿' },
    { key: 'place', name: '장소', score: 5, level: 'neutral', label: '상관없음', emoji: '' },
    { key: 'start', name: '하루 시작', score: 5, level: 'neutral', label: '상관없음', emoji: '' },
    { key: 'budget', name: '예산', score: 5, level: 'neutral', label: '상관없음', emoji: '' },
  ],
  likes: [{ id: 'like_food', text: '맛집', emoji: '🍽️' }],
  dislikes: [{ id: 'dislike_walk', text: '오래 걷기', emoji: '🚶' }],
  mustKeep: [{ type: 'food', label: '해산물' }],
  wishes: ['해산물은 꼭 먹고 싶어요'],
  source: 'llm',
  updatedAt: '2026-10-14T21:30:00+09:00',
};

const info = { trip: session.trip, members: [session.member] };

function bodyOf(call: Call): unknown {
  assert.ok(call.init?.body !== undefined);
  return JSON.parse(call.init.body);
}

test('createTrip: POST /api/v1/trips, 본문, 토큰 없음', async () => {
  const { endpoints, calls } = setup(201, session);
  const result = await endpoints.createTrip('부산 여행', '민수', true);
  assert.deepEqual(result, session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://host/api/v1/trips');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(bodyOf(calls[0]), { title: '부산 여행', nickname: '민수', demoMode: true });
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('getInvite: GET /api/v1/invites/:code, 인코딩, 토큰 없음', async () => {
  const { endpoints, calls } = setup(200, info);
  const result = await endpoints.getInvite('BSN482');
  assert.deepEqual(result, info);
  assert.equal(calls[0].url, 'http://host/api/v1/invites/BSN482');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.headers?.Authorization, undefined);

  await endpoints.getInvite('a b/가?');
  assert.equal(calls[1].url, `http://host/api/v1/invites/${encodeURIComponent('a b/가?')}`);
});

test('joinInvite: POST /api/v1/invites/:code/join, 본문, 인코딩, 토큰 없음', async () => {
  const { endpoints, calls } = setup(201, session);
  const result = await endpoints.joinInvite('a b/c', '지민');
  assert.deepEqual(result, session);
  assert.equal(calls[0].url, `http://host/api/v1/invites/${encodeURIComponent('a b/c')}/join`);
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(bodyOf(calls[0]), { nickname: '지민' });
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('getTrip: GET /api/v1/trips/:id, Bearer 토큰', async () => {
  const { endpoints, calls } = setup(200, { ...info, conditions: null });
  const result = await endpoints.getTrip('trp_1');
  assert.deepEqual(result, info);
  assert.equal(calls[0].url, 'http://host/api/v1/trips/trp_1');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.headers?.Authorization, 'Bearer tok');
});

test('getQuestions: GET /api/v1/persona/questions, 토큰 없음', async () => {
  const { endpoints, calls } = setup(200, { questions: MOCK_QUESTIONS });
  const result = await endpoints.getQuestions();
  assert.deepEqual(result, MOCK_QUESTIONS);
  assert.equal(calls[0].url, 'http://host/api/v1/persona/questions');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('submitPersona: POST /api/v1/me/persona, { answers } 본문, Bearer 토큰, Persona 파싱', async () => {
  const { endpoints, calls } = setup(201, { persona });
  const answers: SubmitAnswer[] = [
    { questionId: 'q1', value: 10 },
    { questionId: 'q13', optionIds: ['like_food'] },
    { questionId: 'q15', text: '해산물' },
  ];
  const result = await endpoints.submitPersona(answers);
  assert.deepEqual(result, persona);
  assert.equal(calls[0].url, 'http://host/api/v1/me/persona');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(bodyOf(calls[0]), { answers });
  assert.equal(calls[0].init?.headers?.Authorization, 'Bearer tok');
});

test('getPersona: GET /api/v1/me/persona, Bearer 토큰, Persona 파싱', async () => {
  const { endpoints, calls } = setup(200, { persona });
  const result = await endpoints.getPersona();
  assert.deepEqual(result, persona);
  assert.equal(calls[0].url, 'http://host/api/v1/me/persona');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.headers?.Authorization, 'Bearer tok');
});

test('서버 오류의 status·code·message가 그대로 전달됨', async () => {
  const cases: [number, string, string, (e: ReturnType<typeof createEndpoints>) => Promise<unknown>][] = [
    [409, 'TRIP_FULL', '여행 인원이 가득 찼습니다. (최대 4명)', (e) => e.joinInvite('BSN482', 'x')],
    [404, 'NOT_FOUND', '초대 코드를 찾을 수 없습니다.', (e) => e.getInvite('ZZZZZZ')],
    [400, 'VALIDATION_ERROR', '3번 문항에 답해 주세요.', (e) => e.submitPersona([])],
    [401, 'UNAUTHORIZED', '인증이 필요합니다. 여행에 다시 참여해 주세요.', (e) => e.getPersona()],
    [403, 'FORBIDDEN', '이 여행에 접근할 권한이 없습니다.', (e) => e.getTrip('trp_2')],
    [400, 'VALIDATION_ERROR', '여행 이름은 1~40자로 입력해 주세요.', (e) => e.createTrip('', 'a', false)],
    [500, 'INTERNAL_ERROR', '서버 오류', (e) => e.getQuestions()],
  ];
  for (const [status, code, message, run] of cases) {
    const { endpoints } = setup(status, { error: { code, message } });
    await assert.rejects(run(endpoints), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      return true;
    });
  }
});
