import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubmitBody,
  firstUnanswered,
  isAnswered,
  isComplete,
  progress,
  setScale,
  setText,
  toggleOption,
} from './answers.ts';
import type {
  AnswerState,
  MultiQuestion,
  Question,
  ScaleQuestion,
  TextQuestion,
} from './types.ts';

function scale(n: number): ScaleQuestion {
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

const q1 = scale(1);
const q2 = scale(2);

const likes: MultiQuestion = {
  id: 'q13',
  order: 13,
  type: 'multi',
  text: '여행에서 좋아하는 것을 골라 주세요',
  minSelect: 1,
  maxSelect: 5,
  options: [
    { id: 'like_nature', text: '자연·풍경', emoji: '🌲' },
    { id: 'like_sea', text: '바다', emoji: '🌊' },
    { id: 'like_spa', text: '온천·스파', emoji: '♨️' },
    { id: 'like_history', text: '역사', emoji: '🏯' },
    { id: 'like_culture', text: '문화·전시', emoji: '🎨' },
    { id: 'like_food', text: '맛집', emoji: '🍽️' },
  ],
};

const dislikes: MultiQuestion = {
  id: 'q14',
  order: 14,
  type: 'multi',
  text: '여행에서 싫은 것을 골라 주세요 (없으면 넘어가도 됨)',
  minSelect: 0,
  maxSelect: 3,
  options: [
    { id: 'dislike_walk', text: '오래 걷기', emoji: '🚶' },
    { id: 'dislike_early', text: '이른 출발', emoji: '⏰' },
    { id: 'dislike_crowd', text: '붐비는 곳', emoji: '👥' },
    { id: 'dislike_queue', text: '줄 서는 맛집', emoji: '⏳' },
  ],
};

const wish: TextQuestion = {
  id: 'q15',
  order: 15,
  type: 'text',
  text: '이번 여행에서 꼭 지켰으면 하는 것이 있나요?',
  required: false,
  maxLength: 200,
  placeholder: '예: 해산물은 꼭 먹고 싶어요',
};

const QUESTIONS: Question[] = [q1, q2, likes, dislikes, wish];

function throwsKorean(fn: () => unknown, pattern?: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /[가-힣]/);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('setScale: 0점도 답으로 인정', () => {
  const state = setScale({}, q1, 0);
  assert.deepEqual(state, { q1: { type: 'scale', value: 0 } });
  assert.equal(isAnswered(q1, state), true);
  assert.deepEqual(setScale({}, q1, 10).q1, { type: 'scale', value: 10 });
});

test('setScale: 범위 밖·소수는 한국어 Error', () => {
  for (const value of [-1, 11, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    throwsKorean(() => setScale({}, q1, value), /1번/);
  }
});

test('setScale: 문항의 min~max를 기준으로 검사하고 원래 state는 바꾸지 않음', () => {
  const narrow: ScaleQuestion = { ...scale(3), min: 1, max: 4 };
  throwsKorean(() => setScale({}, narrow, 0), /3번/);
  throwsKorean(() => setScale({}, narrow, 5), /3번/);
  assert.deepEqual(setScale({}, narrow, 4).q3, { type: 'scale', value: 4 });

  const before: AnswerState = { q1: { type: 'scale', value: 3 } };
  const after = setScale(before, q1, 8);
  assert.deepEqual(before, { q1: { type: 'scale', value: 3 } });
  assert.deepEqual(after.q1, { type: 'scale', value: 8 });
});

test('toggleOption: 선택과 해제', () => {
  const s1 = toggleOption({}, likes, 'like_sea');
  assert.deepEqual(s1.q13, { type: 'multi', optionIds: ['like_sea'] });
  const s2 = toggleOption(s1, likes, 'like_nature');
  assert.deepEqual(s2.q13, { type: 'multi', optionIds: ['like_sea', 'like_nature'] });
  const s3 = toggleOption(s2, likes, 'like_sea');
  assert.deepEqual(s3.q13, { type: 'multi', optionIds: ['like_nature'] });
  assert.deepEqual(s1.q13, { type: 'multi', optionIds: ['like_sea'] });
});

test('toggleOption: maxSelect를 넘는 새 선택은 무시하고 같은 state 반환, 해제는 가능', () => {
  let state: AnswerState = {};
  const five = ['like_nature', 'like_sea', 'like_spa', 'like_history', 'like_culture'];
  for (const id of five) state = toggleOption(state, likes, id);
  const next = toggleOption(state, likes, 'like_food');
  assert.equal(next, state);
  assert.deepEqual(next.q13, { type: 'multi', optionIds: five });

  const released = toggleOption(state, likes, 'like_spa');
  assert.deepEqual(released.q13, {
    type: 'multi',
    optionIds: ['like_nature', 'like_sea', 'like_history', 'like_culture'],
  });
  const added = toggleOption(released, likes, 'like_food');
  assert.deepEqual(added.q13, {
    type: 'multi',
    optionIds: ['like_nature', 'like_sea', 'like_history', 'like_culture', 'like_food'],
  });
});

test('toggleOption: 문항에 없는 옵션은 한국어 Error', () => {
  throwsKorean(() => toggleOption({}, likes, 'like_moon'), /13번/);
  throwsKorean(() => toggleOption({}, likes, 'dislike_walk'), /dislike_walk/);
});

test('isAnswered: multi는 선택 개수가 minSelect~maxSelect 안이어야 함', () => {
  assert.equal(isAnswered(dislikes, {}), true);
  assert.equal(isAnswered(likes, {}), false);
  const one = toggleOption({}, likes, 'like_spa');
  assert.equal(isAnswered(likes, one), true);
  assert.equal(isAnswered(likes, toggleOption(one, likes, 'like_spa')), false);
  assert.equal(
    isAnswered(dislikes, {
      q14: { type: 'multi', optionIds: ['dislike_walk', 'dislike_early', 'dislike_crowd'] },
    }),
    true,
  );
  assert.equal(
    isAnswered(dislikes, {
      q14: {
        type: 'multi',
        optionIds: ['dislike_walk', 'dislike_early', 'dislike_crowd', 'dislike_queue'],
      },
    }),
    false,
  );
});

test('isAnswered: text는 required가 아니면 항상 true, required면 비어 있지 않아야 함', () => {
  assert.equal(isAnswered(wish, {}), true);
  assert.equal(isAnswered(wish, setText({}, wish, '   ')), true);
  const required: TextQuestion = { ...wish, required: true };
  assert.equal(isAnswered(required, {}), false);
  assert.equal(isAnswered(required, setText({}, required, '   ')), false);
  assert.equal(isAnswered(required, setText({}, required, ' 해산물 ')), true);
});

test('setText: 앞뒤 공백 제거 후 maxLength로 자름', () => {
  const short: TextQuestion = { ...wish, maxLength: 5 };
  assert.deepEqual(setText({}, short, '  가나다라마바사  ').q15, { type: 'text', text: '가나다라마' });
  assert.deepEqual(setText({}, wish, '  해산물  ').q15, { type: 'text', text: '해산물' });
});

test('isComplete·firstUnanswered·progress: isAnswered 기준', () => {
  let state: AnswerState = {};
  assert.equal(isComplete(QUESTIONS, state), false);
  assert.equal(firstUnanswered(QUESTIONS, state), 0);
  assert.deepEqual(progress(QUESTIONS, state), { answered: 2, total: 5 });

  state = setScale(state, q1, 0);
  assert.equal(firstUnanswered(QUESTIONS, state), 1);
  assert.deepEqual(progress(QUESTIONS, state), { answered: 3, total: 5 });

  state = setScale(state, q2, 7);
  assert.equal(firstUnanswered(QUESTIONS, state), 2);
  assert.equal(isComplete(QUESTIONS, state), false);

  state = toggleOption(state, likes, 'like_nature');
  assert.equal(firstUnanswered(QUESTIONS, state), null);
  assert.equal(isComplete(QUESTIONS, state), true);
  assert.deepEqual(progress(QUESTIONS, state), { answered: 5, total: 5 });
});

test('buildSubmitBody: order 순, 건드리지 않은 q14는 [], 빈 q15는 빠짐', () => {
  let state: AnswerState = {};
  state = setScale(state, q2, 7);
  state = setScale(state, q1, 0);
  state = toggleOption(state, likes, 'like_spa');
  state = toggleOption(state, likes, 'like_nature');
  state = setText(state, wish, '   ');
  assert.deepEqual(buildSubmitBody([wish, dislikes, likes, q2, q1], state), {
    answers: [
      { questionId: 'q1', value: 0 },
      { questionId: 'q2', value: 7 },
      { questionId: 'q13', optionIds: ['like_spa', 'like_nature'] },
      { questionId: 'q14', optionIds: [] },
    ],
  });
});

test('buildSubmitBody: q15가 있으면 포함, minSelect>0 문항이 비면 생략', () => {
  let state: AnswerState = {};
  state = setScale(state, q1, 10);
  state = toggleOption(state, likes, 'like_sea');
  state = toggleOption(state, likes, 'like_sea');
  state = toggleOption(state, dislikes, 'dislike_crowd');
  state = setText(state, wish, ' 해산물은 꼭 먹고 싶어요 ');
  assert.deepEqual(buildSubmitBody(QUESTIONS, state), {
    answers: [
      { questionId: 'q1', value: 10 },
      { questionId: 'q14', optionIds: ['dislike_crowd'] },
      { questionId: 'q15', text: '해산물은 꼭 먹고 싶어요' },
    ],
  });
});
