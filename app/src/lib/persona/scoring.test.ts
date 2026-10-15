import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRulePersona, pickChips, scoreTraits, TRAITS } from './scoring.ts';
import type { AnswerState, MultiQuestion, Question, TextQuestion } from './types.ts';

// 성향 순서(plan, pace, vibe, place, start, budget)대로 원하는 점수가 나오도록 답을 만든다.
function stateFor(scores: number[]): AnswerState {
  const state: AnswerState = {};
  scores.forEach((score, i) => {
    const total = score * 2;
    const plus = Math.min(10, total);
    state[`q${i + 1}`] = { type: 'scale', value: plus };
    state[`q${i + 7}`] = { type: 'scale', value: 10 - (total - plus) };
  });
  return state;
}

function throwsKorean(fn: () => unknown, pattern?: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /[가-힣]/);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

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
    { id: 'dislike_crowd', text: '붐비는 곳', emoji: '👥' },
  ],
};

const wish: TextQuestion = {
  id: 'q15',
  order: 15,
  type: 'text',
  text: '이번 여행에서 꼭 지켰으면 하는 것이 있나요?',
  required: false,
  maxLength: 200,
  placeholder: '',
};

const QUESTIONS: Question[] = [likes, dislikes, wish];
const MEMBER = { id: 'mem_02', nickname: '지은', color: '#EC4899', no: 2 };
const NOW = '2026-10-14T21:30:00+09:00';
const EXAMPLE = [5.5, 1.5, 2.0, 4.5, 2.5, 5.0];

const CARDS: Record<string, [string, string, string]> = {
  계획형: ['꼼꼼한 플래너', '일정표는 제가 챙길게요!', '여행 체크리스트가 세 장 넘음'],
  즉흥형: ['자유로운 모험가', '일단 가 보고 정해요~', '지도 앱보다 감을 더 믿음'],
  부지런형: ['부지런한 탐방가', '하나라도 더 보고 가요!', '여행 첫날 만 보는 기본'],
  느긋형: ['느긋한 힐러', '천천히 가도 괜찮아요~', '숙소 침대와 금방 친해짐'],
  활기형: ['신나는 분위기메이커', '사람 많은 곳이 신나요!', '축제 소식엔 귀가 쫑긋'],
  한적형: ['조용한 산책가', '조용한 곳으로 가요~', '한적한 골목을 귀신같이 찾음'],
  탐험형: ['숨은 길 탐험가', '아무도 모르는 곳 찾아봐요!', '골목 끝까지 가 봐야 직성이 풀림'],
  명소형: ['인증샷 수집가', '유명한 곳은 꼭 가 봐야죠!', '인증샷 각도 연구가 취미'],
  아침형: ['새벽 일출러', '아침 일찍 출발해요!', '알람보다 먼저 일어남'],
  늦잠형: ['느지막한 여행자', '아침은 천천히 시작해요~', '아침 9시는 새벽이라고 생각함'],
  투자형: ['통 큰 여행자', '여행에선 아끼지 말아요!', '맛있으면 비싸도 괜찮음'],
  절약형: ['알뜰 여행자', '가성비 좋은 곳 찾아올게요!', '할인 쿠폰 모으는 게 취미'],
  기본: ['뭐든 좋은 여행자', '다 좋아요, 같이 정해요!', '어디든 함께라면 즐거움'],
};

function persona(state: AnswerState, source: 'llm' | 'rule' = 'rule') {
  return buildRulePersona({ member: MEMBER, answers: state, questions: QUESTIONS, source, now: NOW });
}

test('TRAITS: 키·이름·low/high 라벨·이모지와 순서', () => {
  assert.deepEqual(
    TRAITS.map((t) => [t.key, t.name, t.lowLabel, t.lowEmoji, t.highLabel, t.highEmoji]),
    [
      ['plan', '계획', '즉흥형', '🎲', '계획형', '📋'],
      ['pace', '속도', '느긋형', '🐢', '부지런형', '🏃'],
      ['vibe', '분위기', '한적형', '🌿', '활기형', '🎉'],
      ['place', '장소', '명소형', '📸', '탐험형', '🧭'],
      ['start', '하루 시작', '늦잠형', '😴', '아침형', '🌅'],
      ['budget', '예산', '절약형', '🐷', '투자형', '💳'],
    ],
  );
});

test('scoreTraits: ((+)점수 + (10 − (−)점수)) ÷ 2, 반올림 없음', () => {
  const state: AnswerState = {
    q1: { type: 'scale', value: 8 },
    q7: { type: 'scale', value: 2 },
    q2: { type: 'scale', value: 3 },
    q8: { type: 'scale', value: 6 },
    q3: { type: 'scale', value: 0 },
    q9: { type: 'scale', value: 10 },
    q4: { type: 'scale', value: 10 },
    q10: { type: 'scale', value: 0 },
    q5: { type: 'scale', value: 4 },
    q11: { type: 'scale', value: 3 },
    q6: { type: 'scale', value: 1 },
    q12: { type: 'scale', value: 6 },
  };
  assert.deepEqual(scoreTraits(state), [
    { key: 'plan', name: '계획', score: 8, level: 'high', label: '계획형', emoji: '📋' },
    { key: 'pace', name: '속도', score: 3.5, level: 'neutral', label: '상관없음', emoji: '' },
    { key: 'vibe', name: '분위기', score: 0, level: 'low', label: '한적형', emoji: '🌿' },
    { key: 'place', name: '장소', score: 10, level: 'high', label: '탐험형', emoji: '🧭' },
    { key: 'start', name: '하루 시작', score: 5.5, level: 'neutral', label: '상관없음', emoji: '' },
    { key: 'budget', name: '예산', score: 2.5, level: 'low', label: '절약형', emoji: '🐷' },
  ]);
});

test('검증용 예: 칩은 느긋형 🐢, 한적형 🌿, 늦잠형 😴 순서', () => {
  const traits = scoreTraits(stateFor(EXAMPLE));
  assert.deepEqual(
    traits.map((t) => t.score),
    EXAMPLE,
  );
  assert.deepEqual(
    traits.map((t) => t.level),
    ['neutral', 'low', 'low', 'neutral', 'low', 'neutral'],
  );
  assert.deepEqual(pickChips(traits), [
    { label: '느긋형', emoji: '🐢' },
    { label: '한적형', emoji: '🌿' },
    { label: '늦잠형', emoji: '😴' },
  ]);
});

test('경계값: 3 → low, 7 → high, 3.5·6.5 → neutral', () => {
  const traits = scoreTraits(stateFor([3, 7, 3.5, 6.5, 0, 10]));
  assert.deepEqual(
    traits.map((t) => [t.level, t.label, t.emoji]),
    [
      ['low', '즉흥형', '🎲'],
      ['high', '부지런형', '🏃'],
      ['neutral', '상관없음', ''],
      ['neutral', '상관없음', ''],
      ['low', '늦잠형', '😴'],
      ['high', '투자형', '💳'],
    ],
  );
});

test('pickChips: 모든 성향이 neutral이면 🍀 뭐든 좋아', () => {
  for (const scores of [
    [5, 5, 5, 5, 5, 5],
    [4, 6, 3.5, 6.5, 5, 5.5],
  ]) {
    assert.deepEqual(pickChips(scoreTraits(stateFor(scores))), [{ label: '뭐든 좋아', emoji: '🍀' }]);
  }
});

test('pickChips: 동점이면 성향 순서', () => {
  assert.deepEqual(pickChips(scoreTraits(stateFor([8, 2, 5, 5, 5, 5]))), [
    { label: '계획형', emoji: '📋' },
    { label: '느긋형', emoji: '🐢' },
  ]);
  assert.deepEqual(pickChips(scoreTraits(stateFor([5, 5, 5, 5, 2, 8]))), [
    { label: '늦잠형', emoji: '😴' },
    { label: '투자형', emoji: '💳' },
  ]);
  assert.deepEqual(pickChips(scoreTraits(stateFor([5, 5, 7, 5, 3, 5]))), [
    { label: '활기형', emoji: '🎉' },
    { label: '늦잠형', emoji: '😴' },
  ]);
});

test('pickChips: 최대 3개, |점수−5|가 큰 순', () => {
  assert.deepEqual(pickChips(scoreTraits(stateFor([0, 10, 1, 9, 2, 8]))), [
    { label: '즉흥형', emoji: '🎲' },
    { label: '부지런형', emoji: '🏃' },
    { label: '한적형', emoji: '🌿' },
  ]);
  assert.deepEqual(pickChips(scoreTraits(stateFor([7, 7, 7, 7, 0.5, 7]))), [
    { label: '늦잠형', emoji: '😴' },
    { label: '계획형', emoji: '📋' },
    { label: '부지런형', emoji: '🏃' },
  ]);
});

test('scoreTraits: 1~12번 답이 하나라도 없으면 문항 번호가 든 한국어 Error', () => {
  const missing = stateFor([5, 5, 5, 5, 5, 5]);
  delete missing.q12;
  throwsKorean(() => scoreTraits(missing), /12번/);

  const wrongType = stateFor([5, 5, 5, 5, 5, 5]);
  wrongType.q3 = { type: 'text', text: '5' };
  throwsKorean(() => scoreTraits(wrongType), /3번/);

  throwsKorean(() => scoreTraits({}), /번 문항/);
  throwsKorean(() => persona(missing), /12번/);
});

test('buildRulePersona: 검증용 예의 전체 persona', () => {
  const state: AnswerState = {
    ...stateFor(EXAMPLE),
    q13: { type: 'multi', optionIds: ['like_spa', 'like_nature'] },
    q14: { type: 'multi', optionIds: ['dislike_crowd'] },
    q15: { type: 'text', text: '  해산물은 꼭 먹고 싶어요  ' },
  };
  assert.deepEqual(persona(state, 'llm'), {
    memberId: 'mem_02',
    nickname: '지은',
    color: '#EC4899',
    no: 2,
    title: '느긋한 힐러',
    catchphrase: '천천히 가도 괜찮아요~',
    tmi: '숙소 침대와 금방 친해짐',
    chips: [
      { label: '느긋형', emoji: '🐢' },
      { label: '한적형', emoji: '🌿' },
      { label: '늦잠형', emoji: '😴' },
    ],
    traits: scoreTraits(state),
    likes: [
      { id: 'like_nature', text: '자연·풍경', emoji: '🌲' },
      { id: 'like_spa', text: '온천·스파', emoji: '♨️' },
    ],
    dislikes: [{ id: 'dislike_crowd', text: '붐비는 곳', emoji: '👥' }],
    mustKeep: [],
    wishes: ['해산물은 꼭 먹고 싶어요'],
    source: 'llm',
    updatedAt: NOW,
  });
});

test('buildRulePersona: 모든 성향·레벨 조합의 카드 문장과 글자 수 한도', () => {
  const seen = new Set<string>();
  TRAITS.forEach((trait, i) => {
    for (const [score, label] of [
      [0, trait.lowLabel],
      [10, trait.highLabel],
    ] as const) {
      const scores = [5, 5, 5, 5, 5, 5];
      scores[i] = score;
      const result = persona(stateFor(scores));
      assert.deepEqual(result.chips, [
        { label, emoji: score === 0 ? trait.lowEmoji : trait.highEmoji },
      ]);
      assert.deepEqual([result.title, result.catchphrase, result.tmi], CARDS[label], label);
      seen.add(label);
    }
  });
  assert.equal(seen.size, 12);

  for (const [title, catchphrase, tmi] of Object.values(CARDS)) {
    assert.ok(Array.from(title).length <= 12, title);
    assert.ok(Array.from(catchphrase).length <= 30, catchphrase);
    assert.ok(Array.from(tmi).length <= 30, tmi);
  }
});

test('buildRulePersona: 칩이 뭐든 좋아 하나뿐이면 기본 카드, 닉네임은 문구에 쓰지 않음', () => {
  const result = persona(stateFor([5, 5, 5, 5, 5, 5]));
  assert.deepEqual(result.chips, [{ label: '뭐든 좋아', emoji: '🍀' }]);
  assert.deepEqual([result.title, result.catchphrase, result.tmi], CARDS.기본);
  for (const text of [result.title, result.catchphrase, result.tmi]) {
    assert.equal(text.includes(MEMBER.nickname), false);
  }
});

test('buildRulePersona: 가장 강한 칩 기준으로 카드를 고름', () => {
  const result = persona(stateFor([8, 5, 5, 0.5, 5, 7]));
  assert.equal(result.chips[0].label, '명소형');
  assert.equal(result.title, '인증샷 수집가');
});

test('buildRulePersona: 선택이 없으면 likes·dislikes·wishes는 빈 배열, source는 인자 그대로', () => {
  const state: AnswerState = {
    ...stateFor(EXAMPLE),
    q13: { type: 'multi', optionIds: ['like_sea'] },
    q15: { type: 'text', text: '   ' },
  };
  const result = persona(state, 'rule');
  assert.deepEqual(result.likes, [{ id: 'like_sea', text: '바다', emoji: '🌊' }]);
  assert.deepEqual(result.dislikes, []);
  assert.deepEqual(result.wishes, []);
  assert.deepEqual(result.mustKeep, []);
  assert.equal(result.source, 'rule');
  assert.equal(result.updatedAt, NOW);
  assert.deepEqual(persona(stateFor(EXAMPLE)).wishes, []);
});
