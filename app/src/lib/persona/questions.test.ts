import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInviteInfo,
  parseMember,
  parsePersona,
  parseQuestions,
  parseSessionResponse,
} from './questions.ts';

const q7 = {
  id: 'q7',
  order: 7,
  type: 'scale',
  axis: 'JP',
  text: '여행 일정은?',
  left: '미리 짠다',
  right: '그때그때 정한다',
};
const q13 = {
  id: 'q13',
  order: 13,
  type: 'multi',
  text: '관심사는?',
  options: [
    { id: 'q13_hotspring', text: '온천' },
    { id: 'q13_food', text: '맛집' },
  ],
};
const q15 = { id: 'q15', order: 15, type: 'text', required: false, maxLength: 200, text: '하고 싶은 말' };

const trip = { id: 'trp_8f3k2', title: '부산', inviteCode: 'BSN482', status: 'preparing' };
const member = {
  id: 'mem_04',
  nickname: '민수',
  color: '#10B981',
  isHost: true,
  personaReady: false,
  mbti: null,
};
const persona = {
  memberId: 'mem_04',
  mbti: 'ISFP',
  title: '느긋한 힐러',
  summary: '요약',
  speechStyle: '말투',
  axes: [{ pair: 'EI', letter: 'I', percent: 78 }],
  interests: ['온천'],
  mustDo: ['산책'],
  dealBreakers: ['빡빡한 일정'],
  source: 'llm',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withChange(base: object, change: Record<string, unknown>): unknown {
  return { ...base, ...change };
}

test('parseQuestions: 명세 예시를 정확히 파싱', () => {
  const result = parseQuestions({ questions: [q7, q13, q15] });
  assert.deepEqual(result, [q7, q13, q15]);
});

test('parseQuestions: 섞인 순서를 order 오름차순으로 정렬', () => {
  const result = parseQuestions({ questions: [q15, q7, q13] });
  assert.deepEqual(
    result.map((q) => q.id),
    ['q7', 'q13', 'q15'],
  );
});

test('parseQuestions: 문항 개수는 강제하지 않음', () => {
  assert.deepEqual(parseQuestions({ questions: [] }), []);
});

test('parseQuestions: 형식 오류는 한국어 Error', () => {
  const bad: unknown[] = [
    null,
    {},
    { questions: 'x' },
    { questions: [7] },
    { questions: [withChange(q7, { type: 'slider' })] },
    { questions: [withChange(q7, { axis: 'XY' })] },
    { questions: [withChange(q13, { options: [] })] },
    { questions: [withChange(q13, { options: 'x' })] },
    { questions: [withChange(q13, { options: [{ id: 'a' }] })] },
    { questions: [withChange(q15, { maxLength: 0 })] },
    { questions: [withChange(q15, { maxLength: 1.5 })] },
    { questions: [withChange(q15, { maxLength: '200' })] },
    { questions: [withChange(q15, { required: 'no' })] },
    { questions: [withChange(q7, { order: 1.5 })] },
    { questions: [withChange(q7, { order: '7' })] },
    { questions: [withChange(q7, { text: undefined })] },
    { questions: [withChange(q7, { left: 3 })] },
    { questions: [withChange(q7, { id: undefined })] },
  ];
  for (const input of bad) {
    assert.throws(
      () => parseQuestions(input),
      (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
      JSON.stringify(input),
    );
  }
});

test('parsePersona: 명세 예시를 통과', () => {
  assert.deepEqual(parsePersona({ persona }), persona);
  assert.equal(parsePersona({ persona: { ...persona, source: 'template' } }).source, 'template');
});

test('parsePersona: 래퍼 누락·source·axes 오류는 한국어 Error', () => {
  const bad: unknown[] = [
    persona,
    null,
    { persona: null },
    { persona: withChange(persona, { source: 'gpt' }) },
    { persona: withChange(persona, { axes: 'x' }) },
    { persona: withChange(persona, { axes: [{ pair: 'ZZ', letter: 'I', percent: 78 }] }) },
    { persona: withChange(persona, { axes: [{ pair: 'EI', letter: 'I', percent: '78' }] }) },
    { persona: withChange(persona, { axes: [{ pair: 'EI', percent: 78 }] }) },
    { persona: withChange(persona, { interests: [1] }) },
    { persona: withChange(persona, { mustDo: undefined }) },
    { persona: withChange(persona, { mbti: undefined }) },
  ];
  for (const input of bad) {
    assert.throws(
      () => parsePersona(input),
      (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
      JSON.stringify(input),
    );
  }
});

test('parseMember: 정상값과 mbti 문자열/null', () => {
  assert.deepEqual(parseMember(member), member);
  assert.equal(parseMember({ ...member, mbti: 'ENFP' }).mbti, 'ENFP');
});

test('parseMember: 형식 오류는 한국어 Error', () => {
  const bad: unknown[] = [
    null,
    'x',
    withChange(member, { id: 1 }),
    withChange(member, { nickname: undefined }),
    withChange(member, { color: undefined }),
    withChange(member, { isHost: 'true' }),
    withChange(member, { personaReady: 1 }),
    withChange(member, { mbti: 5 }),
    withChange(member, { mbti: undefined }),
  ];
  for (const input of bad) {
    assert.throws(
      () => parseMember(input),
      (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
      JSON.stringify(input),
    );
  }
});

test('parseSessionResponse: 정상값과 오류', () => {
  const ok = { trip, member, token: 'tok' };
  assert.deepEqual(parseSessionResponse(clone(ok)), ok);
  for (const status of ['preparing', 'meeting', 'voting', 'confirmed']) {
    assert.equal(parseSessionResponse({ ...ok, trip: { ...trip, status } }).trip.status, status);
  }
  const bad: unknown[] = [
    null,
    { trip, member },
    { trip, member, token: 1 },
    { member, token: 'tok' },
    { trip, token: 'tok' },
    { trip: { ...trip, status: 'done' }, member, token: 'tok' },
    { trip: { ...trip, inviteCode: undefined }, member, token: 'tok' },
    { trip, member: { ...member, isHost: 'x' }, token: 'tok' },
  ];
  for (const input of bad) {
    assert.throws(
      () => parseSessionResponse(input),
      (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
      JSON.stringify(input),
    );
  }
});

test('parseInviteInfo: 정상값과 오류', () => {
  const ok = { trip, members: [member, { ...member, id: 'mem_05', mbti: 'ISFP' }] };
  assert.deepEqual(parseInviteInfo(clone(ok)), ok);
  assert.deepEqual(parseInviteInfo({ trip, members: [] }).members, []);
  const bad: unknown[] = [
    null,
    { trip },
    { trip, members: 'x' },
    { members: [] },
    { trip: { ...trip, status: 'x' }, members: [] },
    { trip, members: [{ ...member, nickname: 3 }] },
  ];
  for (const input of bad) {
    assert.throws(
      () => parseInviteInfo(input),
      (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
      JSON.stringify(input),
    );
  }
});
