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
import type { AnswerState, MultiQuestion, Question, ScaleQuestion, TextQuestion } from './types.ts';

const q1: ScaleQuestion = {
  id: 'q1',
  order: 1,
  type: 'scale',
  axis: 'EI',
  text: '모임이 끝나면?',
  left: '충전된다',
  right: '지친다',
};
const q13: MultiQuestion = {
  id: 'q13',
  order: 13,
  type: 'multi',
  text: '관심사는?',
  options: [
    { id: 'q13_hotspring', text: '온천' },
    { id: 'q13_food', text: '맛집' },
  ],
};
const q15: TextQuestion = {
  id: 'q15',
  order: 15,
  type: 'text',
  required: false,
  maxLength: 5,
  text: '하고 싶은 말',
};
const questions: Question[] = [q1, q13, q15];

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('setScale: 1~4 정수만 허용', () => {
  for (const value of [1, 2, 3, 4]) {
    assert.deepEqual(setScale({}, 'q1', value), { q1: { type: 'scale', value } });
  }
  for (const value of [0, 5, 2.5, NaN, Infinity, -1]) {
    assert.throws(
      () => setScale({}, 'q1', value),
      (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
      String(value),
    );
  }
});

test('setScale: 기존 값을 덮어쓰고 다른 답은 유지', () => {
  const state = setScale(setScale({}, 'q1', 1), 'q2', 3);
  assert.deepEqual(setScale(state, 'q1', 4), {
    q1: { type: 'scale', value: 4 },
    q2: { type: 'scale', value: 3 },
  });
});

test('toggleOption: 추가·제거, 마지막 해제 시 미완료', () => {
  let state: AnswerState = toggleOption({}, 'q13', 'q13_hotspring');
  assert.deepEqual(state.q13, { type: 'multi', optionIds: ['q13_hotspring'] });
  assert.equal(isAnswered(q13, state), true);
  state = toggleOption(state, 'q13', 'q13_food');
  assert.deepEqual(state.q13, { type: 'multi', optionIds: ['q13_hotspring', 'q13_food'] });
  state = toggleOption(state, 'q13', 'q13_hotspring');
  assert.deepEqual(state.q13, { type: 'multi', optionIds: ['q13_food'] });
  state = toggleOption(state, 'q13', 'q13_food');
  assert.equal(isAnswered(q13, state), false);
});

test('setText: 공백 제거, maxLength 자르기, 공백만이면 빈 문자열', () => {
  assert.deepEqual(setText({}, q15, '  안녕  ').q15, { type: 'text', text: '안녕' });
  assert.deepEqual(setText({}, q15, '1234567').q15, { type: 'text', text: '12345' });
  assert.deepEqual(setText({}, q15, '   \n ').q15, { type: 'text', text: '' });
});

test('isAnswered: 문항 종류별 판정', () => {
  assert.equal(isAnswered(q1, {}), false);
  assert.equal(isAnswered(q1, setScale({}, 'q1', 2)), true);
  assert.equal(isAnswered(q13, {}), false);
  assert.equal(isAnswered(q13, { q13: { type: 'multi', optionIds: [] } }), false);
  assert.equal(isAnswered(q15, {}), true);
  assert.equal(isAnswered(q15, setText({}, q15, '')), true);
  const required: TextQuestion = { ...q15, required: true };
  assert.equal(isAnswered(required, {}), false);
  assert.equal(isAnswered(required, setText({}, required, '  ')), false);
  assert.equal(isAnswered(required, setText({}, required, '네')), true);
});

test('isComplete / firstUnanswered / progress', () => {
  let state: AnswerState = {};
  assert.equal(isComplete(questions, state), false);
  assert.equal(firstUnanswered(questions, state), 0);
  assert.deepEqual(progress(questions, state), { answered: 1, total: 3 });

  state = setScale(state, 'q1', 3);
  assert.equal(firstUnanswered(questions, state), 1);
  assert.deepEqual(progress(questions, state), { answered: 2, total: 3 });

  state = toggleOption(state, 'q13', 'q13_food');
  assert.equal(isComplete(questions, state), true);
  assert.equal(firstUnanswered(questions, state), null);
  assert.deepEqual(progress(questions, state), { answered: 3, total: 3 });
});

test('buildSubmitBody: 순서대로 만들고 빈 q15는 생략, 있으면 포함', () => {
  let state: AnswerState = setScale({}, 'q1', 4);
  state = toggleOption(state, 'q13', 'q13_hotspring');
  assert.deepEqual(buildSubmitBody(questions, state), {
    answers: [
      { questionId: 'q1', value: 4 },
      { questionId: 'q13', optionIds: ['q13_hotspring'] },
    ],
  });
  assert.deepEqual(buildSubmitBody(questions, setText(state, q15, '  ')).answers.length, 2);

  const withText = buildSubmitBody(questions, setText(state, q15, '맛집 좋아'));
  assert.deepEqual(withText.answers[2], { questionId: 'q15', text: '맛집 좋' + '아' });
});

test('buildSubmitBody: 문항이 섞여 있어도 order 순서', () => {
  const state = toggleOption(setScale({}, 'q1', 1), 'q13', 'q13_food');
  const body = buildSubmitBody([q13, q1], state);
  assert.deepEqual(
    body.answers.map((a) => a.questionId),
    ['q1', 'q13'],
  );
});

test('모든 함수는 입력을 변경하지 않음', () => {
  const state = deepFreeze<AnswerState>({
    q1: { type: 'scale', value: 2 },
    q13: { type: 'multi', optionIds: ['q13_food'] },
  });
  const frozenQuestions = deepFreeze(structuredClone(questions));
  const before = structuredClone(state);

  setScale(state, 'q1', 3);
  toggleOption(state, 'q13', 'q13_food');
  toggleOption(state, 'q13', 'q13_hotspring');
  setText(state, q15, ' 글 ');
  isAnswered(q1, state);
  isComplete(frozenQuestions, state);
  firstUnanswered(frozenQuestions, state);
  progress(frozenQuestions, state);
  const body = buildSubmitBody(frozenQuestions, state);

  assert.deepEqual(state, before);
  assert.deepEqual(frozenQuestions, questions);
  (body.answers[1] as { optionIds: string[] }).optionIds.push('x');
  assert.deepEqual(state, before);
});
