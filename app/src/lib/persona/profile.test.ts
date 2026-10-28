import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubmitBody } from './answers.ts';
import {
  createProfileStore,
  extractProfile,
  isProfileComplete,
  mergeProfile,
  partyQuestions,
  profileChips,
  profileQuestions,
  profileTraits,
} from './profile.ts';
import { MOCK_QUESTIONS } from '../api/mockQuestions.ts';
import type { KeyValueStore } from '../session/session.ts';
import type { AnswerState } from './types.ts';

function memoryKv(): { kv: KeyValueStore; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    kv: {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value);
      },
      removeItem: async (key) => {
        data.delete(key);
      },
    },
  };
}

const scales: AnswerState = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`q${i + 1}`, { type: 'scale' as const, value: 8 }]),
);
const likesQuestion = MOCK_QUESTIONS.find((q) => q.id === 'q13');
const firstLike = likesQuestion?.type === 'multi' ? likesQuestion.options[0].id : '';
const party: AnswerState = {
  q13: { type: 'multi', optionIds: [firstLike] },
  q14: { type: 'multi', optionIds: [] },
};

test('성향 문항은 1~12번, 파티 문항은 저장된 성향이 있으면 13번부터', () => {
  assert.equal(profileQuestions(MOCK_QUESTIONS).length, 12);
  assert.deepEqual(
    partyQuestions(MOCK_QUESTIONS, true).map((q) => q.order),
    [13, 14, 15],
  );
  assert.equal(partyQuestions(MOCK_QUESTIONS, false).length, 15);
});

test('답 전체에서 1~12번 점수만 뽑는다', () => {
  const all: AnswerState = { ...scales, ...party, q15: { type: 'text', text: '바다' } };
  const extracted = extractProfile(MOCK_QUESTIONS, all);
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(scales).sort());
});

test('12개가 다 있어야 완성, 모자라거나 없으면 아니다', () => {
  assert.equal(isProfileComplete(MOCK_QUESTIONS, scales), true);
  const { q12: _drop, ...rest } = scales;
  assert.equal(isProfileComplete(MOCK_QUESTIONS, rest), false);
  assert.equal(isProfileComplete(MOCK_QUESTIONS, null), false);
});

test('저장된 성향과 파티 답을 합치면 15문항 제출 본문이 된다', () => {
  const merged = mergeProfile(scales, { ...party, q15: { type: 'text', text: '일출' } });
  const body = buildSubmitBody(MOCK_QUESTIONS, merged);
  assert.equal(body.answers.length, 15);
  assert.equal(body.answers[0].questionId, 'q1');
});

test('저장된 점수로 성향과 대표 칩을 계산한다', () => {
  assert.equal(profileTraits(scales)?.length, 6);
  assert.ok(profileChips(scales).length >= 1);
  assert.equal(profileTraits(null), null);
  assert.equal(profileTraits({ q1: { type: 'scale', value: 3 } }), null);
  assert.deepEqual(profileChips(null), []);
});

test('성향 저장소: 저장·복원·삭제와 알림', async () => {
  const { kv, data } = memoryKv();
  const store = createProfileStore(kv);
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  await store.save(scales);
  assert.equal(calls, 1);
  assert.equal(store.get()?.q3?.type, 'scale');

  const again = createProfileStore(kv);
  assert.deepEqual(await again.load(), scales);

  await store.clear();
  assert.equal(store.get(), null);
  assert.equal(data.size, 0);
  assert.equal(calls, 2);
  off();
});

test('성향 저장소: 깨진 저장값은 없는 것으로 본다', async () => {
  const { kv, data } = memoryKv();
  data.set('journey.profile.v1', '{not json');
  assert.equal(await createProfileStore(kv).load(), null);
  data.set('journey.profile.v1', JSON.stringify({ q1: { type: 'scale', value: 'x' }, q2: 5 }));
  assert.equal(await createProfileStore(kv).load(), null);
});
