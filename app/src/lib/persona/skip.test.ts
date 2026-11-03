import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSubmitBody, setScale, setSingle } from './answers.ts';
import { canMoveOn, isReadyToSubmit, isSkippable } from './skip.ts';
import type { ScaleQuestion, SingleQuestion } from './types.ts';

const pace: SingleQuestion = {
  id: 'q17',
  order: 14,
  type: 'single',
  text: '이번 여행 속도',
  required: true,
  options: [
    { id: 'pace_slow', text: '여유', emoji: '🐢' },
    { id: 'pace_packed', text: '알차게', emoji: '🏃' },
  ],
};
const scale: ScaleQuestion = { id: 'q1', order: 1, type: 'scale', text: '계획', min: 0, max: 10, minLabel: '아니다', maxLabel: '그렇다' };

test('속도 문항은 고르지 않아도 넘어갈 수 있고, 다른 필수 문항은 답해야 넘어간다', () => {
  assert.equal(isSkippable(pace), true);
  assert.equal(canMoveOn(pace, {}), true);
  assert.equal(isSkippable(scale), false);
  assert.equal(canMoveOn(scale, {}), false);
  assert.equal(canMoveOn(scale, setScale({}, scale, 5)), true);
});

test('속도를 건너뛰면 제출할 수 있고, 보낼 답에는 속도가 빠진다', () => {
  const state = setScale({}, scale, 7);
  assert.equal(isReadyToSubmit([scale, pace], state), true);
  assert.equal(isReadyToSubmit([scale, pace], {}), false);
  assert.deepEqual(buildSubmitBody([scale, pace], state).answers.map((a) => a.questionId), ['q1']);
  assert.deepEqual(buildSubmitBody([scale, pace], setSingle(state, pace, 'pace_slow')).answers.map((a) => a.questionId), ['q1', 'q17']);
});
