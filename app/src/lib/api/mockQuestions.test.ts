import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuestions } from '../persona/questions.ts';
import type { MultiQuestion } from '../persona/types.ts';
import { MOCK_QUESTIONS } from './mockQuestions.ts';

const SCALE_TEXTS = [
  '여행 가면 미리 세운 계획대로 움직인다',
  '여행 중에는 쉬지 않고 여러 곳을 다니고 싶다',
  '사람들로 북적이는 활기찬 곳이 즐겁다',
  '남들이 잘 모르는 새로운 곳에 가 보고 싶다',
  '여행 가면 아침 일찍 일어나 하루를 시작하는 게 좋다',
  '여행에서는 돈이 좀 들어도 하고 싶은 것은 하는 편이다',
  '여행 일정은 그때그때 즉흥적으로 정하는 편이다',
  '여행에서는 내 속도대로 느긋하게 다니는 게 좋다',
  '여행지에서도 붐비는 곳은 피하고 조용한 곳을 찾는다',
  '이미 유명하고 검증된 곳 위주로 가는 게 마음 편하다',
  '나는 아침형보다 저녁형에 가깝다',
  '여행 경비를 아끼려고 더 싼 곳을 찾아보는 편이다',
];

function multi(id: string): MultiQuestion {
  const question = MOCK_QUESTIONS.find((q) => q.id === id);
  assert.ok(question && question.type === 'multi');
  return question;
}

test('MOCK_QUESTIONS: 15개, order 1~15, id q1~q15', () => {
  assert.equal(MOCK_QUESTIONS.length, 15);
  assert.deepEqual(
    MOCK_QUESTIONS.map((q) => q.order),
    Array.from({ length: 15 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    MOCK_QUESTIONS.map((q) => q.id),
    Array.from({ length: 15 }, (_, i) => `q${i + 1}`),
  );
});

test('MOCK_QUESTIONS: 1~12번은 0~10 척도이고 문구가 확정 글자와 같음', () => {
  const scales = MOCK_QUESTIONS.slice(0, 12);
  assert.deepEqual(
    scales.map((q) => q.text),
    SCALE_TEXTS,
  );
  for (const question of scales) {
    assert.deepEqual(question, {
      id: question.id,
      order: question.order,
      type: 'scale',
      text: question.text,
      min: 0,
      max: 10,
      minLabel: '전혀 아니다',
      maxLabel: '매우 그렇다',
    });
  }
});

test('MOCK_QUESTIONS: 응답 JSON에 axis 같은 채점 필드가 없음', () => {
  const json = JSON.stringify({ questions: MOCK_QUESTIONS });
  for (const key of ['axis', 'trait', 'reverse', 'sign', 'weight']) {
    assert.equal(json.includes(`"${key}"`), false, key);
  }
  for (const question of JSON.parse(json).questions.slice(0, 12)) {
    assert.deepEqual(Object.keys(question).sort(), [
      'id',
      'max',
      'maxLabel',
      'min',
      'minLabel',
      'order',
      'text',
      'type',
    ]);
  }
});

test('MOCK_QUESTIONS: q13 좋아요 선택지', () => {
  const q13 = multi('q13');
  assert.equal(q13.text, '여행에서 좋아하는 것을 골라 주세요');
  assert.equal(q13.minSelect, 1);
  assert.equal(q13.maxSelect, 5);
  assert.deepEqual(
    q13.options.map((o) => [o.id, o.text, o.emoji]),
    [
      ['like_nature', '자연·풍경', '🌲'],
      ['like_sea', '바다', '🌊'],
      ['like_spa', '온천·스파', '♨️'],
      ['like_history', '역사', '🏯'],
      ['like_culture', '문화·전시', '🎨'],
      ['like_festival', '축제·공연', '🎪'],
      ['like_experience', '체험', '🧪'],
      ['like_leisure', '레저·스포츠', '🏄'],
      ['like_shopping', '쇼핑', '🛍️'],
      ['like_food', '맛집', '🍽️'],
      ['like_cafe', '카페', '☕'],
      ['like_night', '야경', '🌃'],
    ],
  );
});

test('MOCK_QUESTIONS: q14 싫어요 선택지', () => {
  const q14 = multi('q14');
  assert.equal(q14.text, '여행에서 싫은 것을 골라 주세요 (없으면 넘어가도 됨)');
  assert.equal(q14.minSelect, 0);
  assert.equal(q14.maxSelect, 3);
  assert.deepEqual(
    q14.options.map((o) => [o.id, o.text, o.emoji]),
    [
      ['dislike_walk', '오래 걷기', '🚶'],
      ['dislike_early', '이른 출발', '⏰'],
      ['dislike_crowd', '붐비는 곳', '👥'],
      ['dislike_pricey', '비싼 곳', '💸'],
      ['dislike_longmove', '긴 이동', '🚌'],
      ['dislike_queue', '줄 서는 맛집', '⏳'],
    ],
  );
});

test('MOCK_QUESTIONS: q15 자유 입력', () => {
  assert.deepEqual(MOCK_QUESTIONS[14], {
    id: 'q15',
    order: 15,
    type: 'text',
    text: '이번 여행에서 꼭 지켰으면 하는 것이 있나요?',
    required: false,
    maxLength: 200,
    placeholder: '예: 해산물은 꼭 먹고 싶어요, 밤 9시 전엔 숙소에 들어가요',
  });
});

test('MOCK_QUESTIONS: JSON으로 보내고 parseQuestions로 받으면 같은 값', () => {
  const json = JSON.parse(JSON.stringify({ questions: MOCK_QUESTIONS }));
  assert.deepEqual(parseQuestions(json), MOCK_QUESTIONS);
});
