import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import type { ApiClient, FetchLike } from './client.ts';
import { ApiError } from './errors.ts';
import { createMockFetch } from './mock.ts';
import { createMockRoutes } from './mockRoutes.ts';
import { parseInviteInfo, parsePersona, parseSessionResponse } from '../persona/questions.ts';
import type { InviteInfo, Persona, SessionResponse } from '../persona/types.ts';
import { memberColors } from '../theme.ts';

type Answers = Record<string, unknown>[];
type StatusRecord = { method: string; path: string; status: number };

const BASE_URL = 'http://mock.local';

function makeApp(): {
  client: ApiClient;
  setToken: (token: string | null) => void;
  statuses: StatusRecord[];
} {
  let token: string | null = null;
  const statuses: StatusRecord[] = [];
  const inner = createMockFetch(createMockRoutes());
  const fetchFn: FetchLike = async (url, init) => {
    const response = await inner(url, init);
    statuses.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.slice(BASE_URL.length),
      status: response.status,
    });
    return response;
  };
  const client = createApiClient({
    baseUrl: BASE_URL,
    fetchFn,
    getToken: () => token,
  });
  return { client, setToken: (value) => (token = value), statuses };
}

async function createTrip(
  client: ApiClient,
  demoMode = false,
  title = '부산 여행',
  nickname = '민수',
): Promise<SessionResponse> {
  return parseSessionResponse(await client.post('/trips', { title, nickname, demoMode }, { auth: false }));
}

async function join(client: ApiClient, code: string, nickname: string): Promise<SessionResponse> {
  return parseSessionResponse(
    await client.post(`/invites/${code}/join`, { nickname }, { auth: false }),
  );
}

async function members(client: ApiClient, code: string): Promise<InviteInfo> {
  return parseInviteInfo(await client.get(`/invites/${code}`, { auth: false }));
}

async function submit(client: ApiClient, answers: unknown): Promise<Persona> {
  return parsePersona(await client.post('/me/persona', { answers }));
}

async function expectError(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: string,
): Promise<void> {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    if (message !== undefined) assert.ok(e.message.includes(message), e.message);
    return true;
  });
}

async function expectInvalid(client: ApiClient, answers: unknown, message: string): Promise<void> {
  await expectError(
    client.post('/me/persona', { answers }),
    400,
    'VALIDATION_ERROR',
    message,
  );
}

// q1~q12 모두 5, q13 하나, q14·q15 생략.
function base(): Answers {
  const answers: Answers = [];
  for (let i = 1; i <= 12; i++) answers.push({ questionId: `q${i}`, value: 5 });
  answers.push({ questionId: 'q13', optionIds: ['like_food'] });
  return answers;
}

// questionId 항목을 바꾼다. entry가 undefined이면 뺀다.
function replace(answers: Answers, questionId: string, entry?: Record<string, unknown>): Answers {
  const rest = answers.filter((a) => a.questionId !== questionId);
  return entry === undefined ? rest : [...rest, entry];
}

function planAnswers(): Answers {
  let answers = replace(base(), 'q1', { questionId: 'q1', value: 10 });
  answers = replace(answers, 'q7', { questionId: 'q7', value: 0 });
  answers = replace(answers, 'q13', { questionId: 'q13', optionIds: ['like_food', 'like_cafe'] });
  answers = replace(answers, 'q14', { questionId: 'q14', optionIds: ['dislike_walk'] });
  return replace(answers, 'q15', { questionId: 'q15', text: '  해산물은 꼭 먹고 싶어요  ' });
}

test('전체 흐름: 생성 → 참여 → 질문 → 제출 → 조회', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  assert.equal(host.trip.inviteCode, 'BSN482');
  assert.equal(host.trip.title, '부산 여행');
  assert.equal(host.member.nickname, '민수');
  assert.equal(host.member.isHost, true);
  assert.equal(host.member.personaReady, false);
  assert.equal(host.member.title, null);

  const guest = await join(client, 'BSN482', '지민');
  assert.equal(guest.trip.id, host.trip.id);
  assert.equal(guest.member.isHost, false);

  const questions = (await client.get('/persona/questions', { auth: false })) as {
    questions: { id: string }[];
  };
  assert.equal(questions.questions.length, 15);

  // 제출 전 조회는 404
  setToken(host.token);
  await expectError(client.get('/me/persona'), 404, 'NOT_FOUND');

  const persona = await submit(client, planAnswers());
  assert.equal(persona.memberId, host.member.id);
  assert.equal(persona.nickname, '민수');
  assert.equal(persona.color, memberColors[0]);
  assert.equal(persona.no, 1);
  assert.equal(persona.source, 'llm');
  assert.equal(persona.title, '꼼꼼한 플래너');
  assert.deepEqual(persona.chips, [{ label: '계획형', emoji: '📋' }]);
  assert.equal(persona.traits.length, 6);
  assert.deepEqual(
    persona.traits.map((t) => t.key),
    ['plan', 'pace', 'vibe', 'place', 'start', 'budget'],
  );
  assert.equal(persona.traits[0].score, 10);
  assert.equal(persona.traits[0].level, 'high');
  assert.equal(persona.traits[0].label, '계획형');
  assert.equal(persona.traits[1].score, 5);
  assert.equal(persona.traits[1].level, 'neutral');
  assert.deepEqual(persona.likes, [
    { id: 'like_food', text: '맛집', emoji: '🍽️' },
    { id: 'like_cafe', text: '카페', emoji: '☕' },
  ]);
  assert.deepEqual(persona.dislikes, [{ id: 'dislike_walk', text: '오래 걷기', emoji: '🚶' }]);
  assert.deepEqual(persona.wishes, ['해산물은 꼭 먹고 싶어요']);
  assert.match(persona.updatedAt, /\+09:00$/);

  const fetched = await parsePersona(await client.get('/me/persona'));
  assert.deepEqual(fetched, persona);

  const info = await members(client, 'BSN482');
  assert.equal(info.members.length, 2);
  assert.equal(info.members[0].personaReady, true);
  assert.equal(info.members[0].title, '꼼꼼한 플래너');
  assert.equal(info.members[1].personaReady, false);
  assert.equal(info.members[1].title, null);

  // 두 번째 참가자는 no 2, 두 번째 색상
  setToken(guest.token);
  const second = await submit(client, base());
  assert.equal(second.no, 2);
  assert.equal(second.color, memberColors[1]);
  assert.equal(second.nickname, '지민');

  const trip = parseInviteInfo(await client.get(`/trips/${host.trip.id}`));
  assert.equal(trip.members.every((m) => m.personaReady), true);
});

test('HTTP 상태 코드: 제출 201(덮어쓰기 포함), 조회 200, 실패 400·401·404', async () => {
  const { client, setToken, statuses } = makeApp();
  const host = await createTrip(client);
  const last = (): StatusRecord => statuses[statuses.length - 1];
  const persona = { method: 'POST', path: '/api/v1/me/persona' };
  const lookup = { method: 'GET', path: '/api/v1/me/persona' };

  // 토큰 없는 제출은 401
  setToken(null);
  await expectError(client.post('/me/persona', { answers: base() }), 401, 'UNAUTHORIZED');
  assert.deepEqual(last(), { ...persona, status: 401 });

  setToken(host.token);

  // 제출 전 조회는 404
  await expectError(client.get('/me/persona'), 404, 'NOT_FOUND');
  assert.deepEqual(last(), { ...lookup, status: 404 });

  // 검증 실패 제출은 400
  await expectInvalid(client, replace(base(), 'q3'), '3번 문항');
  assert.deepEqual(last(), { ...persona, status: 400 });

  // 첫 제출과 덮어쓰기(2번째, 3번째)는 모두 201
  for (let i = 0; i < 3; i++) {
    await submit(client, base());
    assert.deepEqual(last(), { ...persona, status: 201 });
  }

  // 제출 후 조회는 200
  await client.get('/me/persona');
  assert.deepEqual(last(), { ...lookup, status: 200 });
});

test('시연 모드: 시드 구성원 3명', async () => {
  const { client } = makeApp();
  const host = await createTrip(client, true);
  const info = await members(client, host.trip.inviteCode);
  assert.equal(info.members.length, 4);
  assert.deepEqual(
    info.members.map((m) => [m.nickname, m.title, m.personaReady, m.color, m.isHost]),
    [
      ['민수', null, false, memberColors[0], true],
      ['지은', '반짝반짝 탐험가', true, memberColors[1], false],
      ['현우', '꼼꼼한 맛집 플래너', true, memberColors[2], false],
      ['서연', '느긋한 힐러', true, memberColors[3], false],
    ],
  );
  await expectError(client.post(`/invites/BSN482/join`, { nickname: '다섯째' }, { auth: false }), 409, 'TRIP_FULL');
});

test('5번째 참가자는 409 TRIP_FULL', async () => {
  const { client } = makeApp();
  await createTrip(client);
  await join(client, 'BSN482', 'a');
  await join(client, 'BSN482', 'b');
  await join(client, 'BSN482', 'c');
  await expectError(
    client.post('/invites/BSN482/join', { nickname: 'd' }, { auth: false }),
    409,
    'TRIP_FULL',
  );
});

test('초대 코드는 대소문자를 무시하고 모르는 코드는 404', async () => {
  const { client } = makeApp();
  const host = await createTrip(client);
  const info = await members(client, 'bsn482');
  assert.equal(info.trip.id, host.trip.id);
  const guest = await join(client, 'bSn482', '지민');
  assert.equal(guest.trip.id, host.trip.id);
  await expectError(client.get('/invites/ZZZZZZ', { auth: false }), 404, 'NOT_FOUND');
  await expectError(
    client.post('/invites/ZZZZZZ/join', { nickname: 'x' }, { auth: false }),
    404,
    'NOT_FOUND',
  );
});

test('닉네임·여행 이름 검증은 400', async () => {
  const { client } = makeApp();
  await expectError(
    client.post('/trips', { title: '', nickname: '민수' }, { auth: false }),
    400,
    'VALIDATION_ERROR',
  );
  await expectError(
    client.post('/trips', { title: 'a'.repeat(41), nickname: '민수' }, { auth: false }),
    400,
    'VALIDATION_ERROR',
  );
  await expectError(
    client.post('/trips', { title: '여행', nickname: '   ' }, { auth: false }),
    400,
    'VALIDATION_ERROR',
  );
  await createTrip(client);
  await expectError(
    client.post('/invites/BSN482/join', { nickname: '' }, { auth: false }),
    400,
    'VALIDATION_ERROR',
  );
});

test('토큰 없음·틀림은 401, 다른 여행 조회는 403', async () => {
  const { client, setToken } = makeApp();
  const first = await createTrip(client);
  const second = await createTrip(client, false, '제주 여행', '하늘');
  assert.notEqual(second.trip.inviteCode, 'BSN482');

  setToken(null);
  await expectError(client.get(`/trips/${first.trip.id}`), 401, 'UNAUTHORIZED');
  await expectError(client.get('/me/persona'), 401, 'UNAUTHORIZED');
  await expectError(client.post('/me/persona', { answers: base() }), 401, 'UNAUTHORIZED');

  setToken('bogus');
  await expectError(client.get(`/trips/${first.trip.id}`), 401, 'UNAUTHORIZED');
  await expectError(client.get('/me/persona'), 401, 'UNAUTHORIZED');
  await expectError(client.post('/me/persona', { answers: base() }), 401, 'UNAUTHORIZED');

  setToken(first.token);
  const own = parseInviteInfo(await client.get(`/trips/${first.trip.id}`));
  assert.equal(own.trip.id, first.trip.id);
  await expectError(client.get(`/trips/${second.trip.id}`), 403, 'FORBIDDEN');
});

test('제출 검증: answers가 배열이 아니거나 항목이 잘못됨', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  await expectError(client.post('/me/persona', {}), 400, 'VALIDATION_ERROR');
  await expectError(client.post('/me/persona'), 400, 'VALIDATION_ERROR');
  await expectInvalid(client, { q1: 5 }, 'answers');
  await expectInvalid(client, 'q1', 'answers');
  await expectInvalid(client, [...base(), 5], '객체');
  await expectInvalid(client, [...base(), 'q1'], '객체');
  await expectInvalid(client, [...base(), { questionId: 'q16', value: 5 }], '문항');
  await expectInvalid(client, [...base(), { questionId: 'q0', value: 5 }], '문항');
  await expectInvalid(client, [...base(), { value: 5 }], '문항');
  await expectInvalid(client, [...base(), { questionId: 'q1', value: 5 }], '1번 문항');
  await expectInvalid(
    client,
    [...base(), { questionId: 'q13', optionIds: ['like_sea'] }],
    '13번 문항',
  );
});

test('제출 검증: scale 문항', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  const missing = replace(base(), 'q3');
  await expectError(
    client.post('/me/persona', { answers: missing }),
    400,
    'VALIDATION_ERROR',
    '3번 문항에 답해 주세요.',
  );
  await expectInvalid(client, replace(base(), 'q12'), '12번 문항');

  for (const value of [-1, 11, 5.5, '5', null]) {
    await expectInvalid(client, replace(base(), 'q3', { questionId: 'q3', value }), '3번 문항');
  }
  await expectInvalid(client, replace(base(), 'q3', { questionId: 'q3' }), '3번 문항');
  await expectInvalid(client, replace(base(), 'q9', { questionId: 'q9', value: 11 }), '9번 문항');

  const zero = await submit(client, replace(base(), 'q3', { questionId: 'q3', value: 0 }));
  assert.equal(zero.source, 'llm');
  const ten = await submit(client, replace(base(), 'q3', { questionId: 'q3', value: 10 }));
  assert.equal(ten.traits[2].score, 7.5);
});

test('제출 검증: q13·q14 선택 문항', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  const q13 = (optionIds: unknown): Answers =>
    replace(base(), 'q13', { questionId: 'q13', optionIds });
  const q14 = (optionIds: unknown): Answers =>
    replace(base(), 'q14', { questionId: 'q14', optionIds });

  await expectInvalid(client, replace(base(), 'q13'), '13번 문항');
  await expectInvalid(client, q13([]), '13번 문항');
  await expectInvalid(
    client,
    q13(['like_nature', 'like_sea', 'like_spa', 'like_history', 'like_culture', 'like_festival']),
    '13번 문항',
  );
  await expectInvalid(client, q13(['like_unknown']), '13번 문항');
  await expectInvalid(client, q13(['dislike_walk']), '13번 문항');
  await expectInvalid(client, q13(['like_sea', 'like_sea']), '13번 문항');
  await expectInvalid(client, q13('like_sea'), '13번 문항');
  await expectInvalid(client, q13([1]), '13번 문항');

  await expectInvalid(
    client,
    q14(['dislike_walk', 'dislike_early', 'dislike_crowd', 'dislike_pricey']),
    '14번 문항',
  );
  await expectInvalid(client, q14(['dislike_walk', 'dislike_walk']), '14번 문항');
  await expectInvalid(client, q14(['dislike_unknown']), '14번 문항');
  await expectInvalid(client, q14(['like_sea']), '14번 문항');

  // 5개·0개·3개·생략은 정상
  const five = await submit(
    client,
    q13(['like_nature', 'like_sea', 'like_spa', 'like_history', 'like_culture']),
  );
  assert.equal(five.likes.length, 5);
  const none = await submit(client, q14([]));
  assert.deepEqual(none.dislikes, []);
  const omitted = await submit(client, base());
  assert.deepEqual(omitted.dislikes, []);
  const three = await submit(client, q14(['dislike_walk', 'dislike_early', 'dislike_crowd']));
  assert.equal(three.dislikes.length, 3);
});

test('제출 검증: q15 자유 입력', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  const q15 = (text: unknown): Answers => replace(base(), 'q15', { questionId: 'q15', text });

  await expectInvalid(client, q15('가'.repeat(201)), '15번 문항');
  await expectInvalid(client, q15(123), '15번 문항');
  // 항목은 있는데 text가 없거나 null이면 생략이 아니라 400이다.
  await expectInvalid(client, replace(base(), 'q15', { questionId: 'q15' }), '15번 문항');
  await expectInvalid(client, q15(null), '15번 문항');

  // 실패한 제출은 조회·구성원 상태·횟수를 바꾸지 않는다.
  await expectError(client.get('/me/persona'), 404, 'NOT_FOUND');
  const before = await members(client, 'BSN482');
  assert.equal(before.members[0].personaReady, false);
  assert.equal(before.members[0].title, null);

  const max = await submit(client, q15('가'.repeat(200)));
  assert.equal(max.source, 'llm');
  assert.deepEqual(max.wishes, ['가'.repeat(200)]);
  // 공백을 뺀 길이로 센다.
  const padded = await submit(client, q15(`  ${'나'.repeat(200)}  `));
  assert.deepEqual(padded.wishes, ['나'.repeat(200)]);
  const omitted = await submit(client, base());
  assert.deepEqual(omitted.wishes, []);
});

test('검증 실패는 조회·횟수·구성원 상태를 바꾸지 않음', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  await expectInvalid(client, replace(base(), 'q3'), '3번 문항');
  await expectInvalid(client, 'nope', 'answers');
  await expectError(client.get('/me/persona'), 404, 'NOT_FOUND');
  let info = await members(client, 'BSN482');
  assert.equal(info.members[0].personaReady, false);
  assert.equal(info.members[0].title, null);

  // 401 실패도 횟수에 들어가지 않는다.
  setToken('bogus');
  await expectError(client.post('/me/persona', { answers: base() }), 401, 'UNAUTHORIZED');
  setToken(host.token);

  assert.equal((await submit(client, base())).source, 'llm');
  await expectInvalid(client, replace(base(), 'q5'), '5번 문항');
  assert.equal((await submit(client, base())).source, 'llm');
  assert.equal((await submit(client, base())).source, 'rule');

  // 실패한 제출은 저장된 persona와 title도 바꾸지 않는다.
  const before = await parsePersona(await client.get('/me/persona'));
  await expectInvalid(client, replace(planAnswers(), 'q2'), '2번 문항');
  assert.deepEqual(await parsePersona(await client.get('/me/persona')), before);
  info = await members(client, 'BSN482');
  assert.equal(info.members[0].title, '뭐든 좋은 여행자');
});

test('AI 한도: 구성원별로 처음 2번만 llm, 3번째부터 rule', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  const guest = await join(client, 'BSN482', '지민');

  setToken(host.token);
  const first = await submit(client, planAnswers());
  const second = await submit(client, planAnswers());
  const third = await submit(client, planAnswers());
  const fourth = await submit(client, planAnswers());
  assert.deepEqual(
    [first.source, second.source, third.source, fourth.source],
    ['llm', 'llm', 'rule', 'rule'],
  );
  // source와 갱신 시각을 뺀 내용은 같다.
  const strip = ({ source: _s, updatedAt: _u, ...rest }: Persona) => rest;
  assert.deepEqual(strip(third), strip(first));

  // 다른 구성원은 처음 2번이 다시 llm
  setToken(guest.token);
  assert.equal((await submit(client, planAnswers())).source, 'llm');
  assert.equal((await submit(client, planAnswers())).source, 'llm');
  assert.equal((await submit(client, planAnswers())).source, 'rule');

  // 호스트 조회는 가장 최근(rule) 결과
  setToken(host.token);
  assert.equal((await parsePersona(await client.get('/me/persona'))).source, 'rule');
});

test('다시 제출하면 덮어쓰고 구성원 목록 title도 갱신', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  await submit(client, planAnswers());
  assert.equal((await members(client, 'BSN482')).members[0].title, '꼼꼼한 플래너');

  const latest = await submit(client, base());
  assert.equal(latest.title, '뭐든 좋은 여행자');
  assert.deepEqual(await parsePersona(await client.get('/me/persona')), latest);
  const info = await members(client, 'BSN482');
  assert.equal(info.members[0].personaReady, true);
  assert.equal(info.members[0].title, '뭐든 좋은 여행자');
});

test('모든 scale이 5이면 "뭐든 좋아" 칩과 "뭐든 좋은 여행자"', async () => {
  const { client, setToken } = makeApp();
  const host = await createTrip(client);
  setToken(host.token);

  const persona = await submit(client, base());
  assert.deepEqual(persona.chips, [{ label: '뭐든 좋아', emoji: '🍀' }]);
  assert.equal(persona.title, '뭐든 좋은 여행자');
  assert.equal(persona.traits.length, 6);
  assert.equal(persona.traits.every((t) => t.score === 5 && t.level === 'neutral'), true);
});
