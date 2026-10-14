import test from 'node:test';
import assert from 'node:assert/strict';

import { mockPersona, scoreAxes } from './scoring.ts';
import type { AnswerState, Question, ScaleAxis } from './types.ts';

const AXES: ScaleAxis[] = ['EI', 'SN', 'TF', 'JP'];

const questions: Question[] = [
  ...AXES.flatMap((axis, a) =>
    [0, 1, 2].map((i): Question => ({
      id: `${axis}${i}`,
      order: a * 3 + i + 1,
      type: 'scale',
      axis,
      text: '문항',
      left: '왼쪽',
      right: '오른쪽',
    })),
  ),
  {
    id: 'q13',
    order: 13,
    type: 'multi',
    text: '관심사는?',
    options: [
      { id: 'q13_hotspring', text: '온천' },
      { id: 'q13_food', text: '맛집' },
      { id: 'q13_walk', text: '산책' },
    ],
  },
  {
    id: 'q14',
    order: 14,
    type: 'multi',
    text: '절대 싫은 것은?',
    options: [
      { id: 'q14_early', text: '새벽 기상' },
      { id: 'q14_crowd', text: '긴 줄' },
    ],
  },
  { id: 'q15', order: 15, type: 'text', required: false, maxLength: 200, text: '하고 싶은 말' },
];

function scales(values: [number, number, number][]): AnswerState {
  const state: AnswerState = {};
  AXES.forEach((axis, a) => {
    values[a].forEach((value, i) => {
      state[`${axis}${i}`] = { type: 'scale', value };
    });
  });
  return state;
}

function uniform(values: [number, number, number]): AnswerState {
  return scales([values, values, values, values]);
}

function percentOf(values: [number, number, number]): number {
  return scoreAxes(questions, uniform(values)).axes[0].percent;
}

test('합 7은 앞 글자, 합 8은 뒤 글자 (공식상 percent 56)', () => {
  const seven = scoreAxes(questions, uniform([3, 2, 2]));
  assert.equal(seven.mbti, 'ESTJ');
  assert.equal(seven.axes[0].percent, Math.round(50 + (0.5 / 4.5) * 50));
  assert.equal(seven.axes[0].percent, 56);

  const eight = scoreAxes(questions, uniform([3, 3, 2]));
  assert.equal(eight.mbti, 'INFP');
  assert.equal(eight.axes[0].percent, 56);
});

test('극단값: 합 3은 앞 글자 100, 합 12는 뒤 글자 100', () => {
  const low = scoreAxes(questions, uniform([1, 1, 1]));
  assert.equal(low.mbti, 'ESTJ');
  assert.ok(low.axes.every((axis) => axis.percent === 100));

  const high = scoreAxes(questions, uniform([4, 4, 4]));
  assert.equal(high.mbti, 'INFP');
  assert.ok(high.axes.every((axis) => axis.percent === 100));
});

test('축 순서와 pair', () => {
  const result = scoreAxes(questions, scales([[1, 1, 1], [4, 4, 4], [1, 1, 1], [4, 4, 4]]));
  assert.equal(result.mbti, 'ENTP');
  assert.deepEqual(
    result.axes.map((axis) => axis.pair),
    ['EI', 'SN', 'TF', 'JP'],
  );
});

test('percent는 모든 합에서 50 초과 100 이하', () => {
  for (let sum = 3; sum <= 12; sum++) {
    const a = Math.min(4, sum - 2);
    const b = Math.min(4, sum - a - 1);
    const c = sum - a - b;
    const percent = percentOf([a, b, c]);
    assert.ok(percent > 50 && percent <= 100, `합 ${sum}: ${percent}`);
  }
});

test('답이 빠진 scale 문항은 한국어 Error', () => {
  const state = uniform([2, 2, 2]);
  delete state.TF1;
  assert.throws(
    () => scoreAxes(questions, state),
    (error: unknown) => error instanceof Error && /[가-힣]/.test(error.message),
  );
});

test('mockPersona: 필드 구성', () => {
  const state: AnswerState = {
    ...uniform([4, 4, 4]),
    q13: { type: 'multi', optionIds: ['q13_food', 'q13_hotspring'] },
    q14: { type: 'multi', optionIds: ['q14_crowd'] },
    q15: { type: 'text', text: '야경 보기' },
  };
  const persona = mockPersona('mem_04', state, questions);
  assert.equal(persona.memberId, 'mem_04');
  assert.equal(persona.mbti, 'INFP');
  assert.equal(persona.source, 'template');
  for (const field of [persona.title, persona.summary, persona.speechStyle]) {
    assert.ok(field.trim() !== '' && /[가-힣]/.test(field));
  }
  assert.deepEqual(persona.interests, ['온천', '맛집']);
  assert.deepEqual(persona.dealBreakers, ['긴 줄']);
  assert.ok(persona.mustDo.length > 0);
  assert.ok(persona.mustDo.includes('야경 보기'));
  assert.deepEqual(persona.axes, scoreAxes(questions, state).axes);
});

test('mockPersona: 선택·텍스트가 없어도 mustDo는 비어 있지 않음', () => {
  const persona = mockPersona('mem_01', uniform([1, 1, 1]), questions);
  assert.deepEqual(persona.interests, []);
  assert.deepEqual(persona.dealBreakers, []);
  assert.ok(persona.mustDo.length > 0 && persona.mustDo.every((t) => /[가-힣]/.test(t)));
});

test('입력을 변경하지 않음', () => {
  const state: AnswerState = {
    ...uniform([2, 3, 4]),
    q13: { type: 'multi', optionIds: ['q13_walk'] },
  };
  const stateBefore = structuredClone(state);
  const questionsBefore = structuredClone(questions);
  mockPersona('mem_01', state, questions);
  scoreAxes(questions, state);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(questions, questionsBefore);
});
