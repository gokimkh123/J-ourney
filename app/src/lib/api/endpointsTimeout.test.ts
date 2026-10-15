import test from 'node:test';
import assert from 'node:assert/strict';

import type { ApiClient, RequestOptions } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import type { Persona } from '../persona/types.ts';

type Call = { method: string; path: string; body?: unknown; options?: Omit<RequestOptions, 'body'> };

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

function fakeClient(response: unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: ApiClient = {
    request: async (method, path, options) => {
      calls.push({ method, path, body: options?.body, options });
      return response;
    },
    get: async (path, options) => {
      calls.push({ method: 'GET', path, options });
      return response;
    },
    post: async (path, body, options) => {
      calls.push({ method: 'POST', path, body, options });
      return response;
    },
    put: async (path, body, options) => {
      calls.push({ method: 'PUT', path, body, options });
      return response;
    },
  };
  return { client, calls };
}

test('submitPersona: timeoutMs 20000으로 post하고 persona를 파싱해 돌려줌', async () => {
  const { client, calls } = fakeClient({ persona });
  const answers = [{ questionId: 'q1', value: 10 }];
  const result = await createEndpoints(client).submitPersona(answers);
  assert.deepEqual(result, persona);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/me/persona');
  assert.deepEqual(calls[0].body, { answers });
  assert.deepEqual(calls[0].options, { timeoutMs: 20000 });
});

test('getPersona 등 다른 호출은 timeoutMs를 넘기지 않음', async () => {
  const { client, calls } = fakeClient({ persona });
  await createEndpoints(client).getPersona();
  assert.equal(calls[0].path, '/me/persona');
  assert.equal(calls[0].options?.timeoutMs, undefined);

  const trip = { id: 'trp_1', title: '부산', inviteCode: 'BSN482', status: 'preparing' };
  const member = {
    id: 'mem_01',
    nickname: '민수',
    color: '#F97316',
    isHost: true,
    personaReady: false,
    title: null,
  };
  const other = fakeClient({ trip, member, token: 't', members: [member] });
  const endpoints = createEndpoints(other.client);
  await endpoints.createTrip('부산', '민수', true);
  await endpoints.getInvite('BSN482');
  await endpoints.joinInvite('BSN482', '지민');
  await endpoints.getTrip('trp_1');
  assert.equal(other.calls.length, 4);
  for (const call of other.calls) {
    assert.equal(call.options?.timeoutMs, undefined, call.path);
  }
});
