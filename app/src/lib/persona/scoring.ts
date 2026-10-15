import type {
  AnswerState,
  Chip,
  MultiQuestion,
  Persona,
  PickedOption,
  Question,
  Trait,
  TraitLevel,
} from './types.ts';

export type TraitDef = {
  key: string;
  name: string;
  lowLabel: string;
  lowEmoji: string;
  highLabel: string;
  highEmoji: string;
};

export const TRAITS: readonly TraitDef[] = [
  { key: 'plan', name: '계획', lowLabel: '즉흥형', lowEmoji: '🎲', highLabel: '계획형', highEmoji: '📋' },
  { key: 'pace', name: '속도', lowLabel: '느긋형', lowEmoji: '🐢', highLabel: '부지런형', highEmoji: '🏃' },
  { key: 'vibe', name: '분위기', lowLabel: '한적형', lowEmoji: '🌿', highLabel: '활기형', highEmoji: '🎉' },
  { key: 'place', name: '장소', lowLabel: '명소형', lowEmoji: '📸', highLabel: '탐험형', highEmoji: '🧭' },
  { key: 'start', name: '하루 시작', lowLabel: '늦잠형', lowEmoji: '😴', highLabel: '아침형', highEmoji: '🌅' },
  { key: 'budget', name: '예산', lowLabel: '절약형', lowEmoji: '🐷', highLabel: '투자형', highEmoji: '💳' },
];

const NEUTRAL_LABEL = '상관없음';

// 가짜 서버 내부 채점 기준(앱에 보내는 문항 데이터에는 넣지 않는다): 성향별 [(+)문항, (−)문항].
const TRAIT_QUESTIONS: Record<string, [string, string]> = {
  plan: ['q1', 'q7'],
  pace: ['q2', 'q8'],
  vibe: ['q3', 'q9'],
  place: ['q4', 'q10'],
  start: ['q5', 'q11'],
  budget: ['q6', 'q12'],
};
const LIKES_QUESTION = 'q13';
const DISLIKES_QUESTION = 'q14';
const WISH_QUESTION = 'q15';

const DEFAULT_CHIP: Chip = { label: '뭐든 좋아', emoji: '🍀' };

type Card = { title: string; catchphrase: string; tmi: string };

// 실서버와 같은 규칙 카드 문장. 가장 강한 칩 라벨로 고른다.
const RULE_CARDS: Record<string, Card> = {
  계획형: { title: '꼼꼼한 플래너', catchphrase: '일정표는 제가 챙길게요!', tmi: '여행 체크리스트가 세 장 넘음' },
  즉흥형: { title: '자유로운 모험가', catchphrase: '일단 가 보고 정해요~', tmi: '지도 앱보다 감을 더 믿음' },
  부지런형: { title: '부지런한 탐방가', catchphrase: '하나라도 더 보고 가요!', tmi: '여행 첫날 만 보는 기본' },
  느긋형: { title: '느긋한 힐러', catchphrase: '천천히 가도 괜찮아요~', tmi: '숙소 침대와 금방 친해짐' },
  활기형: { title: '신나는 분위기메이커', catchphrase: '사람 많은 곳이 신나요!', tmi: '축제 소식엔 귀가 쫑긋' },
  한적형: { title: '조용한 산책가', catchphrase: '조용한 곳으로 가요~', tmi: '한적한 골목을 귀신같이 찾음' },
  탐험형: { title: '숨은 길 탐험가', catchphrase: '아무도 모르는 곳 찾아봐요!', tmi: '골목 끝까지 가 봐야 직성이 풀림' },
  명소형: { title: '인증샷 수집가', catchphrase: '유명한 곳은 꼭 가 봐야죠!', tmi: '인증샷 각도 연구가 취미' },
  아침형: { title: '새벽 일출러', catchphrase: '아침 일찍 출발해요!', tmi: '알람보다 먼저 일어남' },
  늦잠형: { title: '느지막한 여행자', catchphrase: '아침은 천천히 시작해요~', tmi: '아침 9시는 새벽이라고 생각함' },
  투자형: { title: '통 큰 여행자', catchphrase: '여행에선 아끼지 말아요!', tmi: '맛있으면 비싸도 괜찮음' },
  절약형: { title: '알뜰 여행자', catchphrase: '가성비 좋은 곳 찾아올게요!', tmi: '할인 쿠폰 모으는 게 취미' },
};

const DEFAULT_CARD: Card = {
  title: '뭐든 좋은 여행자',
  catchphrase: '다 좋아요, 같이 정해요!',
  tmi: '어디든 함께라면 즐거움',
};

function scaleValue(state: AnswerState, questionId: string): number {
  const answer = state[questionId];
  if (answer?.type !== 'scale') {
    throw new Error(`${questionId.slice(1)}번 문항에 답해 주세요.`);
  }
  return answer.value;
}

function levelOf(score: number): TraitLevel {
  if (score <= 3) return 'low';
  if (score >= 7) return 'high';
  return 'neutral';
}

export function scoreTraits(state: AnswerState): Trait[] {
  return TRAITS.map((trait) => {
    const [plus, minus] = TRAIT_QUESTIONS[trait.key];
    const score = (scaleValue(state, plus) + (10 - scaleValue(state, minus))) / 2;
    const level = levelOf(score);
    return {
      key: trait.key,
      name: trait.name,
      score,
      level,
      label: level === 'low' ? trait.lowLabel : level === 'high' ? trait.highLabel : NEUTRAL_LABEL,
      emoji: level === 'low' ? trait.lowEmoji : level === 'high' ? trait.highEmoji : '',
    };
  });
}

export function pickChips(traits: Trait[]): Chip[] {
  // 정렬은 안정적이라 동점이면 성향 순서가 유지된다.
  const chips = traits
    .filter((trait) => trait.level !== 'neutral')
    .sort((a, b) => Math.abs(b.score - 5) - Math.abs(a.score - 5))
    .slice(0, 3)
    .map((trait) => ({ label: trait.label, emoji: trait.emoji }));
  return chips.length > 0 ? chips : [{ ...DEFAULT_CHIP }];
}

function pickedOptions(
  questions: Question[],
  questionId: string,
  answers: AnswerState,
): PickedOption[] {
  const question = questions.find(
    (q): q is MultiQuestion => q.type === 'multi' && q.id === questionId,
  );
  const answer = answers[questionId];
  if (!question || answer?.type !== 'multi') return [];
  return question.options
    .filter((option) => answer.optionIds.includes(option.id))
    .map(({ id, text, emoji }) => ({ id, text, emoji }));
}

export type RulePersonaInput = {
  member: { id: string; nickname: string; color: string; no: number };
  answers: AnswerState;
  questions: Question[];
  source: Persona['source'];
  now: string;
};

export function buildRulePersona({
  member,
  answers,
  questions,
  source,
  now,
}: RulePersonaInput): Persona {
  const traits = scoreTraits(answers);
  const chips = pickChips(traits);
  const card = RULE_CARDS[chips[0].label] ?? DEFAULT_CARD;
  const wish = answers[WISH_QUESTION];
  const wishText = wish?.type === 'text' ? wish.text.trim() : '';
  return {
    memberId: member.id,
    nickname: member.nickname,
    color: member.color,
    no: member.no,
    title: card.title,
    catchphrase: card.catchphrase,
    tmi: card.tmi,
    chips,
    traits,
    likes: pickedOptions(questions, LIKES_QUESTION, answers),
    dislikes: pickedOptions(questions, DISLIKES_QUESTION, answers),
    mustKeep: [],
    wishes: wishText === '' ? [] : [wishText],
    source,
    updatedAt: now,
  };
}
