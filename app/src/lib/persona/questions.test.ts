import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInviteInfo,
  parseMember,
  parsePersona,
  parseQuestions,
  parseSessionResponse,
} from './questions.ts';

function throwsKorean(fn: () => unknown, pattern?: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /[가-힣]/);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

function scaleJson(n: number): Record<string, unknown> {
  return {
    id: `q${n}`,
    order: n,
    type: 'scale',
    text: `${n}번 문항`,
    min: 0,
    max: 10,
    minLabel: '전혀 아니다',
    maxLabel: '매우 그렇다',
  };
}

function q13Json(): Record<string, unknown> {
  return {
    id: 'q13',
    order: 13,
    type: 'multi',
    text: '여행에서 좋아하는 것을 골라 주세요',
    minSelect: 1,
    maxSelect: 5,
    options: [
      { id: 'like_nature', text: '자연·풍경', emoji: '🌲' },
      { id: 'like_spa', text: '온천·스파', emoji: '♨️' },
    ],
  };
}

function q14Json(): Record<string, unknown> {
  return {
    id: 'q14',
    order: 14,
    type: 'multi',
    text: '여행에서 싫은 것을 골라 주세요 (없으면 넘어가도 됨)',
    minSelect: 0,
    maxSelect: 3,
    options: [{ id: 'dislike_crowd', text: '붐비는 곳', emoji: '👥' }],
  };
}

function q15Json(): Record<string, unknown> {
  return {
    id: 'q15',
    order: 15,
    type: 'text',
    text: '이번 여행에서 꼭 지켰으면 하는 것이 있나요?',
    required: false,
    maxLength: 200,
    placeholder: '예: 해산물은 꼭 먹고 싶어요, 밤 9시 전엔 숙소에 들어가요',
  };
}

function questionList(): Record<string, unknown>[] {
  return [
    ...Array.from({ length: 12 }, (_, i) => scaleJson(i + 1)),
    q13Json(),
    q14Json(),
    q15Json(),
  ];
}

const TRAITS_JSON = [
  { key: 'plan', name: '계획', score: 5.5, level: 'neutral', label: '상관없음', emoji: '' },
  { key: 'pace', name: '속도', score: 1.5, level: 'low', label: '느긋형', emoji: '🐢' },
  { key: 'vibe', name: '분위기', score: 2, level: 'low', label: '한적형', emoji: '🌿' },
  { key: 'place', name: '장소', score: 4.5, level: 'neutral', label: '상관없음', emoji: '' },
  { key: 'start', name: '하루 시작', score: 2.5, level: 'low', label: '늦잠형', emoji: '😴' },
  { key: 'budget', name: '예산', score: 5, level: 'neutral', label: '상관없음', emoji: '' },
];

function personaJson() {
  return {
    persona: {
      memberId: 'mem_01',
      nickname: '민수',
      color: '#F97316',
      no: 1,
      title: '느긋한 힐러',
      catchphrase: '천천히 가도 괜찮아요~',
      tmi: '숙소 침대와 금방 친해짐',
      chips: [
        { label: '느긋형', emoji: '🐢' },
        { label: '한적형', emoji: '🌿' },
        { label: '늦잠형', emoji: '😴' },
      ],
      traits: TRAITS_JSON.map((trait) => ({ ...trait })),
      likes: [
        { id: 'like_nature', text: '자연·풍경', emoji: '🌲' },
        { id: 'like_spa', text: '온천·스파', emoji: '♨️' },
      ],
      dislikes: [{ id: 'dislike_crowd', text: '붐비는 곳', emoji: '👥' }],
      mustKeep: [
        { type: 'include', label: '해산물 먹기' },
        { type: 'time', label: '밤 9시 전 숙소 복귀' },
      ],
      wishes: ['해산물은 꼭 먹고 싶어요'],
      source: 'llm',
      updatedAt: '2026-10-14T21:30:00+09:00',
    },
  };
}

function personaWith(patch: Record<string, unknown>): { persona: Record<string, unknown> } {
  return { persona: { ...personaJson().persona, ...patch } };
}

const TRIP = { id: 'trp_1', title: '부산 여행', inviteCode: 'BSN482', status: 'preparing' };
const HOST = {
  id: 'mem_01',
  nickname: '민수',
  color: '#F97316',
  isHost: true,
  personaReady: false,
  title: null,
};
const SEED = {
  id: 'mem_02',
  nickname: '지은',
  color: '#EC4899',
  isHost: false,
  personaReady: true,
  title: '반짝반짝 탐험가',
};

test('parseQuestions: 명세 모양의 15문항이 그대로 파싱됨', () => {
  const questions = parseQuestions({ questions: questionList() });
  assert.equal(questions.length, 15);
  assert.deepEqual(questions, questionList());
});

test('parseQuestions: order 순으로 정렬', () => {
  const questions = parseQuestions({ questions: [...questionList()].reverse() });
  assert.deepEqual(
    questions.map((q) => q.order),
    Array.from({ length: 15 }, (_, i) => i + 1),
  );
  assert.equal(questions[0].id, 'q1');
  assert.equal(questions[14].id, 'q15');
});

test('parseQuestions: 서버가 보낸 추가 필드(axis 등)는 무시', () => {
  const [question] = parseQuestions({
    questions: [
      { ...scaleJson(1), axis: 'plan', reverse: false },
      { ...q13Json(), extra: 1, options: [{ id: 'like_sea', text: '바다', emoji: '🌊', w: 2 }] },
    ],
  });
  assert.deepEqual(question, scaleJson(1));
  assert.equal('axis' in question, false);
  const multi = parseQuestions({
    questions: [{ ...q13Json(), extra: 1, options: [{ id: 'like_sea', text: '바다', emoji: '🌊', w: 2 }] }],
  })[0];
  assert.equal('extra' in multi, false);
  assert.ok(multi.type === 'multi');
  assert.deepEqual(multi.options, [{ id: 'like_sea', text: '바다', emoji: '🌊' }]);
});

test('parseQuestions: options의 emoji, placeholder가 없으면 빈 문자열', () => {
  const questions = parseQuestions({
    questions: [
      { ...q13Json(), options: [{ id: 'like_sea', text: '바다' }] },
      without(q15Json(), 'placeholder'),
    ],
  });
  const [multi, text] = questions;
  assert.ok(multi.type === 'multi');
  assert.deepEqual(multi.options, [{ id: 'like_sea', text: '바다', emoji: '' }]);
  assert.ok(text.type === 'text');
  assert.equal(text.placeholder, '');
});

test('parseQuestions: 누락·잘못된 type은 한국어 Error', () => {
  throwsKorean(() => parseQuestions({ questions: [{ ...scaleJson(1), type: 'slider' }] }), /type/);
  throwsKorean(() => parseQuestions({ questions: [without(scaleJson(1), 'type')] }), /type/);
  throwsKorean(() => parseQuestions({ questions: [without(scaleJson(1), 'min')] }), /min/);
  throwsKorean(() => parseQuestions({ questions: [without(scaleJson(1), 'maxLabel')] }), /maxLabel/);
  throwsKorean(() => parseQuestions({ questions: [{ ...scaleJson(1), max: 7.5 }] }), /max/);
  throwsKorean(() => parseQuestions({ questions: [without(q13Json(), 'options')] }), /options/);
  throwsKorean(() => parseQuestions({ questions: [without(q13Json(), 'maxSelect')] }), /maxSelect/);
  throwsKorean(() => parseQuestions({ questions: [{ ...q13Json(), options: [] }] }), /options/);
  throwsKorean(() => parseQuestions({ questions: [without(q15Json(), 'maxLength')] }), /maxLength/);
  throwsKorean(() => parseQuestions({ questions: [{ ...q15Json(), placeholder: 3 }] }), /placeholder/);
  throwsKorean(() => parseQuestions({ questions: 'x' }), /questions/);
  throwsKorean(() => parseQuestions(null));
});

test('parsePersona: 명세 모양의 persona가 그대로 파싱됨', () => {
  assert.deepEqual(parsePersona(personaJson()), personaJson().persona);
});

test('parsePersona: source는 llm·rule 허용, 그 외는 한국어 Error', () => {
  assert.equal(parsePersona(personaWith({ source: 'rule' })).source, 'rule');
  throwsKorean(() => parsePersona(personaWith({ source: 'template' })), /source/);
  throwsKorean(() => parsePersona(without(personaJson().persona, 'source')), /persona/);
  throwsKorean(() => parsePersona({ persona: without(personaJson().persona, 'source') }), /source/);
});

test('parsePersona: traits level이 잘못되면 한국어 Error', () => {
  throwsKorean(
    () => parsePersona(personaWith({ traits: [{ ...TRAITS_JSON[0], level: 'mid' }] })),
    /level/,
  );
  throwsKorean(
    () => parsePersona(personaWith({ traits: [{ ...TRAITS_JSON[0], score: '5' }] })),
    /score/,
  );
});

test('parsePersona: 필수 필드 누락은 한국어 Error', () => {
  for (const key of ['memberId', 'title', 'catchphrase', 'tmi', 'chips', 'traits', 'updatedAt', 'no']) {
    throwsKorean(() => parsePersona({ persona: without(personaJson().persona, key) }), new RegExp(key));
  }
  throwsKorean(() => parsePersona({}), /persona/);
});

test('parsePersona: 모르는 mustKeep.type도 허용', () => {
  const persona = parsePersona(personaWith({ mustKeep: [{ type: 'weather', label: '비 오면 실내' }] }));
  assert.deepEqual(persona.mustKeep, [{ type: 'weather', label: '비 오면 실내' }]);
  throwsKorean(() => parsePersona(personaWith({ mustKeep: [{ type: 1, label: 'x' }] })), /type/);
});

test('parsePersona: wishes는 문자열·{label}·{text} 객체를 문자열로 받음', () => {
  const persona = parsePersona(
    personaWith({ wishes: ['해산물', { label: '야경 보기' }, { text: '온천 가기' }] }),
  );
  assert.deepEqual(persona.wishes, ['해산물', '야경 보기', '온천 가기']);
  throwsKorean(() => parsePersona(personaWith({ wishes: [3] })), /wishes/);
  throwsKorean(() => parsePersona(personaWith({ wishes: [{}] })), /wishes/);
  throwsKorean(() => parsePersona(personaWith({ wishes: [{ label: 1 }] })), /wishes/);
  throwsKorean(() => parsePersona(personaWith({ wishes: 'x' })), /wishes/);
});

test('parsePersona: 추가 필드는 무시하고 likes emoji가 없으면 빈 문자열', () => {
  const persona = parsePersona(
    personaWith({ mbti: 'ENFP', summary: 'x', likes: [{ id: 'like_sea', text: '바다' }] }),
  );
  assert.equal('mbti' in persona, false);
  assert.equal('summary' in persona, false);
  assert.deepEqual(persona.likes, [{ id: 'like_sea', text: '바다', emoji: '' }]);
});

test('parseMember: title null·문자열 허용, mbti는 읽지 않음', () => {
  assert.deepEqual(parseMember(HOST), HOST);
  assert.deepEqual(parseMember(SEED), SEED);
  const member = parseMember({ ...HOST, mbti: 'ENFP' });
  assert.equal('mbti' in member, false);
  assert.equal(member.title, null);
  throwsKorean(() => parseMember({ ...HOST, title: 3 }), /title/);
  throwsKorean(() => parseMember(without(HOST, 'title')), /title/);
  throwsKorean(() => parseMember(without(HOST, 'personaReady')), /personaReady/);
});

test('parseSessionResponse·parseInviteInfo: 새 Member 모양으로 파싱', () => {
  assert.deepEqual(parseSessionResponse({ trip: TRIP, member: HOST, token: 'tok_1' }), {
    trip: TRIP,
    member: HOST,
    token: 'tok_1',
  });
  assert.deepEqual(parseInviteInfo({ trip: TRIP, members: [HOST, SEED] }), {
    trip: TRIP,
    members: [HOST, SEED],
  });
  throwsKorean(() => parseSessionResponse({ trip: TRIP, member: HOST }), /token/);
  throwsKorean(
    () => parseInviteInfo({ trip: { ...TRIP, status: 'done' }, members: [] }),
    /status/,
  );
  throwsKorean(() => parseInviteInfo({ trip: TRIP, members: [{ ...SEED, title: false }] }), /title/);
});
