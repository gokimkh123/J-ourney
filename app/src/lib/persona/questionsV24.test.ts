import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubmitBody, isAnswered, setOther, setSingle, setTexts, toggleOption } from './answers.ts';
import { partyQuestions } from './profile.ts';
import { parseQuestions } from './questions.ts';
import type { ListQuestion, MultiQuestion, Question, SingleQuestion } from './types.ts';

// 서버 v2.4(origin/main 7849836) GET /persona/questions의 13~17번 모양
const SCALES = Array.from({ length: 12 }, (_, i) => ({
  id: `q${i + 1}`,
  order: i + 1,
  type: 'scale',
  text: `성향 ${i + 1}`,
  min: 0,
  max: 10,
  minLabel: '전혀 아니다',
  maxLabel: '매우 그렇다',
}));
const V24_TAIL = [
  { id: 'q16', order: 13, type: 'list', text: '이번 여행에서 가고 싶은 곳이 있나요?', required: false, maxItems: 3, maxLength: 30, placeholder: '예: 광안리해수욕장' },
  {
    id: 'q17',
    order: 14,
    type: 'single',
    text: '이번 여행은 어떤 속도로 다니고 싶나요?',
    required: true,
    options: [
      { id: 'pace_slow', text: '여유', emoji: '🐢' },
      { id: 'pace_normal', text: '적당', emoji: '🚶' },
      { id: 'pace_packed', text: '알차게', emoji: '🏃' },
    ],
  },
  {
    id: 'q14',
    order: 15,
    type: 'multi',
    text: '여행에서 싫은 것을 골라 주세요 (없으면 넘어가도 됨)',
    minSelect: 0,
    maxSelect: 3,
    options: [
      { id: 'dislike_walk', text: '오래 걷기', emoji: '🚶' },
      { id: 'dislike_early', text: '이른 출발', emoji: '⏰' },
    ],
    other: { maxLength: 50, placeholder: '기타 (직접 입력)' },
  },
  {
    id: 'q13',
    order: 16,
    type: 'multi',
    text: '여행에서 좋아하는 것을 골라 주세요',
    minSelect: 1,
    maxSelect: 2,
    options: [
      { id: 'like_sea', text: '바다', emoji: '🌊' },
      { id: 'like_food', text: '맛집', emoji: '🍽️' },
      { id: 'like_cafe', text: '카페', emoji: '☕' },
    ],
    other: { maxLength: 50, placeholder: '기타 (직접 입력)' },
  },
  { id: 'q15', order: 17, type: 'text', text: '추가로 고려하고 싶은 사항이 있나요?', required: false, maxLength: 200, placeholder: '' },
];

function v24(): Question[] {
  // 서버는 order 순서로 보내지만 섞여 와도 order로 정렬한다.
  return parseQuestions({ questions: [...[...V24_TAIL].reverse(), ...SCALES] });
}

function byId<T extends Question>(questions: Question[], id: string): T {
  const q = questions.find((item) => item.id === id);
  assert.ok(q);
  return q as T;
}

test('v2.4 17문항: 새 형식(list·single)도 읽고 order 순서로 둔다', () => {
  const questions = v24();
  assert.equal(questions.length, 17);
  assert.deepEqual(
    questions.slice(12).map((q) => [q.order, q.id, q.type]),
    [
      [13, 'q16', 'list'],
      [14, 'q17', 'single'],
      [15, 'q14', 'multi'],
      [16, 'q13', 'multi'],
      [17, 'q15', 'text'],
    ],
  );
  const list = byId<ListQuestion>(questions, 'q16');
  assert.deepEqual([list.required, list.maxItems, list.maxLength, list.placeholder], [false, 3, 30, '예: 광안리해수욕장']);
  const single = byId<SingleQuestion>(questions, 'q17');
  assert.equal(single.required, true);
  assert.deepEqual(single.options.map((o) => o.id), ['pace_slow', 'pace_normal', 'pace_packed']);
  assert.deepEqual(byId<MultiQuestion>(questions, 'q13').other, { maxLength: 50, placeholder: '기타 (직접 입력)' });
});

test('v2.4: 기타가 없는 multi는 other 필드 자체가 없다', () => {
  const [q] = parseQuestions({ questions: [{ ...V24_TAIL[2], other: undefined }] });
  assert.ok(q !== undefined && q.type === 'multi');
  assert.equal('other' in q, false);
});

test('v2.4: list·single 형식이 틀리면 한국어로 실패', () => {
  assert.throws(() => parseQuestions({ questions: [{ ...V24_TAIL[0], maxItems: 0 }] }), /maxItems/);
  assert.throws(() => parseQuestions({ questions: [{ ...V24_TAIL[1], options: [] }] }), /options/);
  assert.throws(() => parseQuestions({ questions: [{ ...V24_TAIL[2], other: { maxLength: 'x' } }] }), /other/);
});

test('v2.4: 파티 질문은 저장된 성향이 있으면 13번부터(id가 아니라 순서로 나눔)', () => {
  assert.deepEqual(partyQuestions(v24(), true).map((q) => q.id), ['q16', 'q17', 'q14', 'q13', 'q15']);
});

test('가고 싶은 곳(list): 선택 문항이라 비어도 답한 것으로, 보낼 때는 빈 줄·같은 글을 빼고 앞뒤 공백을 뺀다', () => {
  const questions = v24();
  const list = byId<ListQuestion>(questions, 'q16');
  assert.equal(isAnswered(list, {}), true);
  let state = setTexts({}, list, ['  감천문화마을 ', '', '감천문화마을', '해운대']);
  assert.deepEqual(state.q16, { type: 'list', texts: ['  감천문화마을 ', '', '감천문화마을'] }, '3개까지만 남김(입력 중인 빈 줄 포함)');
  state = setTexts({}, list, ['가'.repeat(40)]);
  assert.equal(state.q16?.type === 'list' && state.q16.texts[0]?.length, 30);
  state = setTexts({}, list, ['  감천문화마을 ', '', '감천문화마을']);
  assert.deepEqual(
    buildSubmitBody([list], state).answers,
    [{ questionId: 'q16', texts: ['감천문화마을'] }],
  );
  assert.deepEqual(buildSubmitBody([list], setTexts({}, list, ['', ' '])).answers, [], '다 비면 보내지 않음');
});

test('속도(single): 필수, 고르면 optionIds 하나로 보내고 없는 보기는 막는다', () => {
  const single = byId<SingleQuestion>(v24(), 'q17');
  assert.equal(isAnswered(single, {}), false);
  const state = setSingle({}, single, 'pace_packed');
  assert.equal(isAnswered(single, state), true);
  assert.deepEqual(buildSubmitBody([single], state).answers, [{ questionId: 'q17', optionIds: ['pace_packed'] }]);
  assert.deepEqual(setSingle(state, single, 'pace_slow').q17, { type: 'single', optionId: 'pace_slow' });
  assert.throws(() => setSingle({}, single, 'pace_fast'), /없는 선택지/);
});

test('기타(multi other): 적으면 최소 개수에 하나로 세고 text로 같이 보낸다', () => {
  const likes = byId<MultiQuestion>(v24(), 'q13');
  assert.equal(isAnswered(likes, {}), false);
  let state = setOther({}, likes, '시장 구경');
  assert.equal(isAnswered(likes, state), true, '보기 없이 기타만 적어도 최소 1개 충족');
  assert.deepEqual(buildSubmitBody([likes], state).answers, [{ questionId: 'q13', optionIds: [], text: '시장 구경' }]);
  // 기타는 최대 개수에 안 센다: 보기 2개(최대) + 기타
  state = toggleOption(toggleOption(state, likes, 'like_sea'), likes, 'like_food');
  assert.deepEqual(state.q13, { type: 'multi', optionIds: ['like_sea', 'like_food'], other: '시장 구경' }, '보기를 골라도 기타 글은 남음');
  assert.equal(isAnswered(likes, state), true);
  assert.deepEqual(buildSubmitBody([likes], state).answers, [{ questionId: 'q13', optionIds: ['like_sea', 'like_food'], text: '시장 구경' }]);
  // 빈 글이면 기타를 지운다
  state = setOther(state, likes, '');
  assert.deepEqual(state.q13, { type: 'multi', optionIds: ['like_sea', 'like_food'] });
  // 공백뿐인 기타는 세지 않는다
  assert.equal(isAnswered(likes, setOther({}, likes, '   ')), false);
  // 50자로 자른다
  const long = setOther({}, likes, '가'.repeat(60)).q13;
  assert.equal(long?.type === 'multi' && long.other?.length, 50);
});

test('기타 칸이 없는 multi에 기타를 넣으면 실패', () => {
  const [q] = parseQuestions({ questions: [{ ...V24_TAIL[2], other: undefined }] });
  assert.ok(q !== undefined && q.type === 'multi');
  assert.throws(() => setOther({}, q, '비'), /기타 입력이 없습니다/);
});

test('싫은 것(min 0)은 기타만 적으면 빈 보기 + text로 보낸다', () => {
  const dislikes = byId<MultiQuestion>(v24(), 'q14');
  assert.deepEqual(buildSubmitBody([dislikes], {}).answers, [{ questionId: 'q14', optionIds: [] }]);
  assert.deepEqual(
    buildSubmitBody([dislikes], setOther({}, dislikes, '비 오는 날 바깥')).answers,
    [{ questionId: 'q14', optionIds: [], text: '비 오는 날 바깥' }],
  );
});
