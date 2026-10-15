import type { Question, ScaleQuestion } from '../persona/types.ts';

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

export const MOCK_QUESTIONS: Question[] = [
  ...SCALE_TEXTS.map(
    (text, i): ScaleQuestion => ({
      id: `q${i + 1}`,
      order: i + 1,
      type: 'scale',
      text,
      min: 0,
      max: 10,
      minLabel: '전혀 아니다',
      maxLabel: '매우 그렇다',
    }),
  ),
  // q13·q14 선택지는 실서버의 현재 값이다. 서버에서 바뀔 수 있으므로 이 파일에만 둔다.
  {
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
      { id: 'like_festival', text: '축제·공연', emoji: '🎪' },
      { id: 'like_experience', text: '체험', emoji: '🧪' },
      { id: 'like_leisure', text: '레저·스포츠', emoji: '🏄' },
      { id: 'like_shopping', text: '쇼핑', emoji: '🛍️' },
      { id: 'like_food', text: '맛집', emoji: '🍽️' },
      { id: 'like_cafe', text: '카페', emoji: '☕' },
      { id: 'like_night', text: '야경', emoji: '🌃' },
    ],
  },
  {
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
      { id: 'dislike_pricey', text: '비싼 곳', emoji: '💸' },
      { id: 'dislike_longmove', text: '긴 이동', emoji: '🚌' },
      { id: 'dislike_queue', text: '줄 서는 맛집', emoji: '⏳' },
    ],
  },
  {
    id: 'q15',
    order: 15,
    type: 'text',
    text: '이번 여행에서 꼭 지켰으면 하는 것이 있나요?',
    required: false,
    maxLength: 200,
    placeholder: '예: 해산물은 꼭 먹고 싶어요, 밤 9시 전엔 숙소에 들어가요',
  },
];
