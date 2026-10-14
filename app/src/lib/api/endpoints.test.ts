import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { FetchLike } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import type { SubmitAnswer } from '../persona/types.ts';

type Call = { url: string; init?: Parameters<FetchLike>[1] };

const trip = { id: 'trp_1', title: '부산', inviteCode: 'BSN482', status: 'preparing' };
const member = {
  id: 'mem_01',
  nickname: '민수',
  color: '#F97316',
  isHost: true,
  personaReady: false,
  mbti: null,
};
const persona = {
  memberId: 'mem_01',
  mbti: 'ISFP',
  title: '느긋한 힐러',
  summary: '요약',
  speechStyle: '말투',
  axes: [{ pair: 'EI', letter: 'I', percent: 78 }],
  interests: ['온천'],
  mustDo: ['산책'],
  dealBreakers: ['긴 줄'],
  source: 'template',
};
const question = {
  id: 'q1',
  order: 1,
  type: 'scale',
  axis: 'EI',
  text: '모임이 끝나면?',
  left: '충전된다',
  right: '지친다',
};

function setup(body: unknown) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const client = createApiClient({
    baseUrl: 'http://host',
    fetchFn,
    getToken: () => 'tok',
  });
  return { endpoints: createEndpoints(client), calls };
}

function isKoreanError(error: unknown): boolean {
  return error instanceof Error && /[가-힣]/.test(error.message);
}

test('createTrip: POST /trips, 본문, 토큰 없음, 세션 파싱', async () => {
  const { endpoints, calls } = setup({ trip, member, token: 'new_tok' });
  const result = await endpoints.createTrip('부산', '민수', true);
  assert.deepEqual(result, { trip, member, token: 'new_tok' });
  assert.equal(calls[0].url, 'http://host/api/v1/trips');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init?.body ?? ''), {
    title: '부산',
    nickname: '민수',
    demoMode: true,
  });
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('joinInvite: POST /invites/{code}/join, 코드 인코딩, 토큰 없음', async () => {
  const { endpoints, calls } = setup({ trip, member, token: 'new_tok' });
  const result = await endpoints.joinInvite('a b/c', '지은');
  assert.equal(result.token, 'new_tok');
  assert.equal(calls[0].url, 'http://host/api/v1/invites/a%20b%2Fc/join');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init?.body ?? ''), { nickname: '지은' });
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('getInvite: GET /invites/{code}, 코드 인코딩, 토큰 없음, 파싱', async () => {
  const { endpoints, calls } = setup({ trip, members: [member] });
  assert.deepEqual(await endpoints.getInvite('a b/c'), { trip, members: [member] });
  assert.equal(calls[0].url, 'http://host/api/v1/invites/a%20b%2Fc');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('getTrip: GET /trips/{id}, 토큰 첨부, trip과 members만 반환', async () => {
  const { endpoints, calls } = setup({ trip, members: [member], conditions: null });
  const result = await endpoints.getTrip('trp_1');
  assert.deepEqual(result, { trip, members: [member] });
  assert.equal(calls[0].url, 'http://host/api/v1/trips/trp_1');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.headers?.Authorization, 'Bearer tok');
});

test('getQuestions: GET /persona/questions, 토큰 없음, 파싱', async () => {
  const { endpoints, calls } = setup({ questions: [question] });
  assert.deepEqual(await endpoints.getQuestions(), [question]);
  assert.equal(calls[0].url, 'http://host/api/v1/persona/questions');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.headers?.Authorization, undefined);
});

test('submitPersona: POST /me/persona, { answers }, 토큰 첨부, Persona 반환', async () => {
  const { endpoints, calls } = setup({ persona });
  const answers: SubmitAnswer[] = [
    { questionId: 'q1', value: 3 },
    { questionId: 'q13', optionIds: ['q13_food'] },
    { questionId: 'q15', text: '야경' },
  ];
  assert.deepEqual(await endpoints.submitPersona(answers), persona);
  assert.equal(calls[0].url, 'http://host/api/v1/me/persona');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init?.body ?? ''), { answers });
  assert.equal(calls[0].init?.headers?.Authorization, 'Bearer tok');
});

test('getPersona: GET /me/persona, 토큰 첨부, Persona 반환', async () => {
  const { endpoints, calls } = setup({ persona });
  assert.deepEqual(await endpoints.getPersona(), persona);
  assert.equal(calls[0].url, 'http://host/api/v1/me/persona');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.headers?.Authorization, 'Bearer tok');
});

test('응답 형식이 틀리면 한국어 Error가 전파됨', async () => {
  const bad = setup({ wrong: true }).endpoints;
  await assert.rejects(bad.createTrip('t', 'n', false), isKoreanError);
  await assert.rejects(bad.joinInvite('X', 'n'), isKoreanError);
  await assert.rejects(bad.getInvite('X'), isKoreanError);
  await assert.rejects(bad.getTrip('trp_1'), isKoreanError);
  await assert.rejects(bad.getQuestions(), isKoreanError);
  await assert.rejects(bad.submitPersona([]), isKoreanError);
  await assert.rejects(bad.getPersona(), isKoreanError);
});
