import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from './client.ts';
import { createEndpoints } from './endpoints.ts';
import { ApiError } from './errors.ts';
import { createMockFetch } from './mock.ts';
import type { MockRoute } from './mock.ts';
import { createMockRoutes } from './mockRoutes.ts';
import { buildSubmitBody, setScale, toggleOption } from '../persona/answers.ts';
import { parsePersona, parseQuestions } from '../persona/questions.ts';
import type {
  AnswerState,
  MultiQuestion,
  Question,
  ScaleAxis,
  ScaleQuestion,
  SubmitAnswer,
  TextQuestion,
} from '../persona/types.ts';
import { memberColors } from '../theme.ts';

const BASE = 'http://mock.local';
const ESTJ: Record<ScaleAxis, number> = { EI: 1, SN: 1, TF: 1, JP: 1 };
const ISFP: Record<ScaleAxis, number> = { EI: 4, SN: 1, TF: 4, JP: 4 };

function setup(routes: MockRoute[] = createMockRoutes()) {
  let token: string | null = null;
  const client = createApiClient({
    baseUrl: BASE,
    fetchFn: createMockFetch(routes),
    getToken: () => token,
  });
  return {
    client,
    api: createEndpoints(client),
    useToken(next: string | null) {
      token = next;
    },
  };
}

function rejectsWith(promise: Promise<unknown>, status: number, code: string) {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.ok(/[가-힣]/.test(error.message), error.message);
    return true;
  });
}

function answersFor(questions: Question[], values: Record<ScaleAxis, number>): SubmitAnswer[] {
  let state: AnswerState = {};
  for (const question of questions) {
    if (question.type === 'scale') state = setScale(state, question.id, values[question.axis]);
    else if (question.type === 'multi') {
      state = toggleOption(state, question.id, question.options[0].id);
    }
  }
  return buildSubmitBody(questions, state).answers;
}

const isKorean = (text: string) => /[가-힣]/.test(text);

test('여행 생성 → 참여 → 질문 → 페르소나 제출 → 조회 전체 흐름', async () => {
  const { client, api, useToken } = setup();

  const host = await api.createTrip('부산 1박 2일', '민수', false);
  assert.equal(host.trip.title, '부산 1박 2일');
  assert.equal(host.trip.inviteCode, 'BSN482');
  assert.equal(host.trip.status, 'preparing');
  assert.equal(host.member.nickname, '민수');
  assert.equal(host.member.isHost, true);
  assert.equal(host.member.color, memberColors[0]);
  assert.equal(host.member.personaReady, false);
  assert.equal(host.member.mbti, null);
  assert.ok(host.token.length > 0);

  const guest = await api.joinInvite(host.trip.inviteCode, '지은');
  assert.deepEqual(guest.trip, host.trip);
  assert.equal(guest.member.isHost, false);
  assert.equal(guest.member.color, memberColors[1]);
  assert.notEqual(guest.member.id, host.member.id);
  assert.notEqual(guest.token, host.token);

  const info = await api.getInvite(host.trip.inviteCode);
  assert.deepEqual(info, { trip: host.trip, members: [host.member, guest.member] });

  useToken(host.token);
  assert.deepEqual(await client.get(`/trips/${host.trip.id}`), {
    trip: host.trip,
    members: info.members,
    conditions: null,
  });
  assert.deepEqual(await api.getTrip(host.trip.id), info);

  const questions = await api.getQuestions();
  assert.equal(questions.length, 15);

  useToken(guest.token);
  const persona = await api.submitPersona(answersFor(questions, ISFP));
  assert.equal(persona.memberId, guest.member.id);
  assert.equal(persona.mbti, 'ISFP');
  assert.equal(persona.source, 'template');
  assert.deepEqual(await api.getPersona(), persona);
  assert.deepEqual(parsePersona(await client.get('/me/persona')), persona);

  const after = await api.getInvite(host.trip.inviteCode);
  assert.deepEqual(
    after.members.map((m) => [m.id, m.personaReady, m.mbti]),
    [
      [host.member.id, false, null],
      [guest.member.id, true, 'ISFP'],
    ],
  );

  useToken(host.token);
  await rejectsWith(api.getPersona(), 404, 'NOT_FOUND');
});

test('생성·참여·제출은 201, 조회는 200, 오류 본문은 { error: { code, message } }', async () => {
  const fetchFn = createMockFetch(createMockRoutes());
  const url = (path: string) => `${BASE}/api/v1${path}`;

  const created = await fetchFn(url('/trips'), {
    method: 'POST',
    body: JSON.stringify({ title: '부산', nickname: '민수', demoMode: false }),
  });
  assert.equal(created.status, 201);
  const host = JSON.parse(await created.text());
  const auth = { Authorization: `Bearer ${host.token}` };

  const joined = await fetchFn(url('/invites/BSN482/join'), {
    method: 'POST',
    body: JSON.stringify({ nickname: '지은' }),
  });
  assert.equal(joined.status, 201);

  assert.equal((await fetchFn(url('/invites/BSN482'))).status, 200);
  assert.equal((await fetchFn(url(`/trips/${host.trip.id}`), { headers: auth })).status, 200);

  const noBearer = await fetchFn(url(`/trips/${host.trip.id}`), {
    headers: { Authorization: host.token },
  });
  assert.equal(noBearer.status, 401);
  const body = JSON.parse(await noBearer.text());
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.ok(isKorean(body.error.message));

  const questions = parseQuestions(JSON.parse(await (await fetchFn(url('/persona/questions'))).text()));
  const submitted = await fetchFn(url('/me/persona'), {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ answers: answersFor(questions, ESTJ) }),
  });
  assert.equal(submitted.status, 201);
  assert.equal(parsePersona(JSON.parse(await submitted.text())).mbti, 'ESTJ');

  const fetched = await fetchFn(url('/me/persona'), { headers: auth });
  assert.equal(fetched.status, 200);
  assert.equal(parsePersona(JSON.parse(await fetched.text())).memberId, host.member.id);
});

test('GET /persona/questions: 토큰 없이 15문항, parseQuestions 통과', async () => {
  const { client } = setup();
  const questions = parseQuestions(await client.get('/persona/questions', { auth: false }));
  assert.equal(questions.length, 15);
  assert.deepEqual(
    questions.map((q) => q.id),
    Array.from({ length: 15 }, (_, i) => `q${i + 1}`),
  );
  assert.deepEqual(
    questions.map((q) => q.order),
    Array.from({ length: 15 }, (_, i) => i + 1),
  );
  for (const question of questions) assert.ok(isKorean(question.text), question.id);

  const scales = questions.filter((q): q is ScaleQuestion => q.type === 'scale');
  assert.equal(scales.length, 12);
  for (const axis of ['EI', 'SN', 'TF', 'JP']) {
    assert.equal(scales.filter((q) => q.axis === axis).length, 3, axis);
  }
  for (const question of scales) {
    assert.ok(isKorean(question.left) && isKorean(question.right), question.id);
  }

  const multis = questions.filter((q): q is MultiQuestion => q.type === 'multi');
  assert.deepEqual(
    multis.map((q) => q.id),
    ['q13', 'q14'],
  );
  for (const question of multis) {
    assert.ok(question.options.length > 1, question.id);
    assert.equal(new Set(question.options.map((o) => o.id)).size, question.options.length);
    assert.ok(question.options.every((o) => isKorean(o.text)), question.id);
  }

  const text = questions.find((q): q is TextQuestion => q.type === 'text');
  assert.ok(text);
  assert.equal(text.id, 'q15');
  assert.equal(text.required, false);
  assert.ok(Number.isInteger(text.maxLength) && text.maxLength > 0);
  assert.equal(questions.filter((q) => q.type === 'text').length, 1);
});

test('토큰이 없거나 틀리면 401 UNAUTHORIZED', async () => {
  const { api, useToken } = setup();
  const host = await api.createTrip('부산', '민수', false);
  const answers = answersFor(await api.getQuestions(), ESTJ);
  for (const token of [null, 'nope', `${host.token}x`]) {
    useToken(token);
    await rejectsWith(api.getTrip(host.trip.id), 401, 'UNAUTHORIZED');
    await rejectsWith(api.submitPersona(answers), 401, 'UNAUTHORIZED');
    await rejectsWith(api.getPersona(), 401, 'UNAUTHORIZED');
  }
  assert.equal((await api.getInvite(host.trip.inviteCode)).members[0].personaReady, false);
});

test('모르는 초대 코드·여행 id는 404 NOT_FOUND', async () => {
  const { api, useToken } = setup();
  await rejectsWith(api.getInvite('ZZZ999'), 404, 'NOT_FOUND');
  await rejectsWith(api.joinInvite('ZZZ999', '지은'), 404, 'NOT_FOUND');
  const host = await api.createTrip('부산', '민수', false);
  await rejectsWith(api.getInvite('ZZZ999'), 404, 'NOT_FOUND');
  useToken(host.token);
  await rejectsWith(api.getTrip('trp_none'), 404, 'NOT_FOUND');
});

test('제목·닉네임 검증 위반은 400 VALIDATION_ERROR', async () => {
  const { client, api } = setup();
  for (const title of ['', '   ', 'a'.repeat(41)]) {
    await rejectsWith(api.createTrip(title, '민수', false), 400, 'VALIDATION_ERROR');
  }
  for (const nickname of ['', '   ', 'a'.repeat(21)]) {
    await rejectsWith(api.createTrip('부산', nickname, false), 400, 'VALIDATION_ERROR');
  }
  for (const body of [{ title: 1, nickname: '민수' }, { title: '부산', nickname: null }, {}]) {
    await rejectsWith(client.post('/trips', body, { auth: false }), 400, 'VALIDATION_ERROR');
  }

  const host = await api.createTrip('a'.repeat(40), 'b'.repeat(20), false);
  assert.equal(host.trip.inviteCode, 'BSN482');
  const code = host.trip.inviteCode;
  for (const nickname of ['', '   ', 'a'.repeat(21)]) {
    await rejectsWith(api.joinInvite(code, nickname), 400, 'VALIDATION_ERROR');
  }
  await rejectsWith(
    client.post(`/invites/${code}/join`, { nickname: 5 }, { auth: false }),
    400,
    'VALIDATION_ERROR',
  );
  await api.joinInvite(code, `  ${'c'.repeat(20)}  `);
  assert.equal((await api.getInvite(code)).members.length, 2);
});

test('시연 모드: 시드 3명, 색상 순서, 5번째 참가는 409 TRIP_FULL', async () => {
  const { api } = setup();
  const host = await api.createTrip('부산', '민수', true);
  const { members } = await api.getInvite(host.trip.inviteCode);
  assert.deepEqual(
    members.map((m) => [m.nickname, m.isHost, m.personaReady, m.mbti, m.color]),
    [
      ['민수', true, false, null, memberColors[0]],
      ['지은', false, true, 'ENFP', memberColors[1]],
      ['현우', false, true, 'ISTJ', memberColors[2]],
      ['서연', false, true, 'ISFP', memberColors[3]],
    ],
  );
  assert.equal(members[0].id, host.member.id);
  assert.equal(new Set(members.map((m) => m.id)).size, 4);

  await rejectsWith(api.joinInvite(host.trip.inviteCode, '철수'), 409, 'TRIP_FULL');
  assert.equal((await api.getInvite(host.trip.inviteCode)).members.length, 4);
});

test('일반 모드: 참여 순서대로 색상, 방장 포함 4명 뒤 5번째는 409 TRIP_FULL', async () => {
  const { api } = setup();
  const host = await api.createTrip('부산', '민수', false);
  assert.equal((await api.getInvite(host.trip.inviteCode)).members.length, 1);
  const names = ['지은', '현우', '서연'];
  for (const [i, nickname] of names.entries()) {
    const joined = await api.joinInvite(host.trip.inviteCode, nickname);
    assert.equal(joined.member.color, memberColors[i + 1]);
    assert.equal(joined.member.isHost, false);
    assert.equal(joined.member.personaReady, false);
  }
  await rejectsWith(api.joinInvite(host.trip.inviteCode, '철수'), 409, 'TRIP_FULL');
  const { members } = await api.getInvite(host.trip.inviteCode);
  assert.deepEqual(
    members.map((m) => m.nickname),
    ['민수', ...names],
  );
  assert.deepEqual(
    members.map((m) => m.color),
    memberColors.slice(0, 4),
  );
});

test('초대 코드는 대소문자를 구분하지 않음', async () => {
  const { api } = setup();
  const host = await api.createTrip('부산', '민수', false);
  assert.deepEqual((await api.getInvite('bsn482')).trip, host.trip);
  const guest = await api.joinInvite('bSn482', '지은');
  assert.equal(guest.trip.id, host.trip.id);
  assert.equal(guest.trip.inviteCode, 'BSN482');
  assert.equal((await api.getInvite('BSN482')).members.length, 2);
});

test('첫 초대 코드는 BSN482, 이후는 겹치지 않는 6자리 대문자·숫자', async () => {
  const { api } = setup();
  const codes: string[] = [];
  for (let i = 0; i < 20; i++) {
    codes.push((await api.createTrip(`여행 ${i}`, '민수', false)).trip.inviteCode);
  }
  assert.equal(codes[0], 'BSN482');
  assert.notEqual(codes[1], 'BSN482');
  for (const code of codes.slice(1)) assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal((await api.getInvite(codes[1])).trip.title, '여행 1');
  assert.equal((await api.getInvite(codes[1].toLowerCase())).trip.title, '여행 1');
});

test('createMockRoutes는 호출마다 새 상태', async () => {
  const first = setup();
  const host = await first.api.createTrip('부산', '민수', false);

  const second = setup();
  await rejectsWith(second.api.getInvite(host.trip.inviteCode), 404, 'NOT_FOUND');
  second.useToken(host.token);
  await rejectsWith(second.api.getTrip(host.trip.id), 401, 'UNAUTHORIZED');
  await rejectsWith(second.api.getPersona(), 401, 'UNAUTHORIZED');

  const other = await second.api.createTrip('서울', '지은', false);
  assert.equal(other.trip.inviteCode, 'BSN482');
  assert.equal((await second.api.getInvite('BSN482')).trip.title, '서울');
  assert.equal((await first.api.getInvite('BSN482')).trip.title, '부산');
});

test('불완전하거나 형식이 틀린 제출은 400이고 페르소나는 만들어지지 않음', async () => {
  const { client, api, useToken } = setup();
  const host = await api.createTrip('부산', '민수', false);
  useToken(host.token);
  const full = answersFor(await api.getQuestions(), ESTJ);
  const replace = (questionId: string, answer: unknown) =>
    full.map((a) => (a.questionId === questionId ? answer : a));

  const invalid: unknown[] = [
    [],
    full.filter((a) => a.questionId !== 'q1'),
    full.filter((a) => a.questionId !== 'q13'),
    [...full, { questionId: 'q99', value: 1 }],
    replace('q1', { questionId: 'q1', optionIds: ['x'] }),
    replace('q2', { questionId: 'q2', value: 5 }),
    replace('q3', { questionId: 'q3', value: '2' }),
    replace('q13', { questionId: 'q13', value: 1 }),
    replace('q13', { questionId: 'q13', optionIds: [1] }),
    replace('q14', { questionId: 'q14', optionIds: [] }),
    [...full, { questionId: 'q15', text: 3 }],
    [...full, 'q15'],
    'x',
    null,
    { q1: 1 },
  ];
  for (const answers of invalid) {
    await rejectsWith(client.post('/me/persona', { answers }), 400, 'VALIDATION_ERROR');
  }
  await rejectsWith(client.post('/me/persona', {}), 400, 'VALIDATION_ERROR');

  await rejectsWith(api.getPersona(), 404, 'NOT_FOUND');
  const [me] = (await api.getInvite(host.trip.inviteCode)).members;
  assert.equal(me.personaReady, false);
  assert.equal(me.mbti, null);

  // 선택 문항 q15는 빠져도 된다.
  assert.equal(full.some((a) => a.questionId === 'q15'), false);
  assert.equal((await api.submitPersona(full)).mbti, 'ESTJ');
});

test('재제출하면 페르소나와 구성원 mbti를 덮어씀', async () => {
  const { api, useToken } = setup();
  const host = await api.createTrip('부산', '민수', false);
  useToken(host.token);
  const questions = await api.getQuestions();
  assert.equal((await api.submitPersona(answersFor(questions, ESTJ))).mbti, 'ESTJ');
  const second = await api.submitPersona(answersFor(questions, ISFP));
  assert.equal(second.mbti, 'ISFP');
  assert.deepEqual(await api.getPersona(), second);
  const [me] = (await api.getInvite(host.trip.inviteCode)).members;
  assert.equal(me.personaReady, true);
  assert.equal(me.mbti, 'ISFP');
});

test('다른 여행의 토큰으로 GET /trips/:tripId 는 403 FORBIDDEN', async () => {
  const { api, useToken } = setup();
  const a = await api.createTrip('부산', '민수', false);
  const b = await api.createTrip('서울', '지은', false);
  useToken(a.token);
  await rejectsWith(api.getTrip(b.trip.id), 403, 'FORBIDDEN');
  assert.equal((await api.getTrip(a.trip.id)).trip.id, a.trip.id);
  useToken(b.token);
  await rejectsWith(api.getTrip(a.trip.id), 403, 'FORBIDDEN');
});
