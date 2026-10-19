import { buildProfile, pickChips, scoreTraits } from './score.js';
import type { PersonaAnswers } from './types.js';
import type { CardText } from './write.js';

interface Seed {
  nickname: string;
  answers: PersonaAnswers;
  card: Omit<CardText, 'source'>;
}

const scale = (values: number[]) => Object.fromEntries(values.map((v, i) => [`q${i + 1}`, v]));

/** 시연 모드(demoMode)에서 자동 참여하는 가상 구성원 3명 — LLM 없이 미리 써 둔 카드를 씀 */
export const DEMO_SEEDS: readonly Seed[] = [
  {
    nickname: '지은',
    answers: {
      scale: scale([3, 7, 9, 9, 5, 7, 8, 4, 2, 3, 6, 5]),
      likes: ['like_festival', 'like_cafe', 'like_night'],
      dislikes: ['dislike_early'],
      mustKeepText: '흰여울문화마을에서 사진은 꼭 찍고 싶어요',
    },
    card: {
      title: '반짝반짝 탐험가',
      catchphrase: '여기 사진 각 나와요!',
      tmi: '카메라 배터리는 늘 두 개',
      mustKeep: [{ type: 'include', label: '흰여울문화마을 사진', quote: '흰여울문화마을에서 사진은 꼭 찍고 싶어요', keyword: '흰여울문화마을', target: 'place', codes: [], start: null, end: null, amount: null }],
      wishes: [],
    },
  },
  {
    nickname: '현우',
    answers: {
      scale: scale([9, 6, 4, 3, 8, 3, 2, 5, 6, 8, 2, 8]),
      likes: ['like_food', 'like_history'],
      dislikes: ['dislike_pricey', 'dislike_longmove'],
      mustKeepText: '돼지국밥은 꼭 먹고, 1인 25만 원은 넘지 않았으면 해요',
    },
    card: {
      title: '꼼꼼한 맛집 플래너',
      catchphrase: '동선부터 정리해 볼게요!',
      tmi: '여행 전날 일정표가 완성됨',
      mustKeep: [
        { type: 'include', label: '돼지국밥 먹기', quote: '돼지국밥은 꼭 먹고', keyword: '돼지국밥', target: 'food', codes: [], start: null, end: null, amount: null },
        { type: 'budget', label: '1인 25만 원 이하', quote: '1인 25만 원은 넘지 않았으면 해요', keyword: null, start: null, end: null, amount: 250000 },
      ],
      wishes: [],
    },
  },
  {
    nickname: '서연',
    answers: {
      scale: scale([5, 2, 2, 5, 2, 5, 5, 9, 8, 6, 7, 5]),
      likes: ['like_spa', 'like_sea', 'like_cafe'],
      dislikes: ['dislike_walk', 'dislike_crowd'],
      mustKeepText: '온천은 꼭 가고, 하루 1만 보는 넘지 않았으면 해요',
    },
    card: {
      title: '느긋한 힐러',
      catchphrase: '오후엔 온천에서 쉬어 가요~',
      tmi: '여행 가방은 늘 반만 채움',
      mustKeep: [
        { type: 'include', label: '온천 가기', quote: '온천은 꼭 가고', keyword: '온천', target: 'category', codes: ['EX050100'], start: null, end: null, amount: null },
        { type: 'steps', label: '하루 1만 보 이하', quote: '하루 1만 보는 넘지 않았으면 해요', keyword: null, start: null, end: null, amount: 10000 },
      ],
      wishes: [],
    },
  },
];

/** 가상 구성원의 personas 행 값 (실제 구성원과 같은 규칙으로 성향·숨은 값을 계산함) */
export function seedPersona(memberId: string, seed: Seed) {
  const traits = scoreTraits(seed.answers.scale);
  return {
    memberId,
    answers: seed.answers,
    traits,
    chips: pickChips(traits),
    ...seed.card,
    profile: buildProfile(traits, seed.answers, seed.card.mustKeep),
    source: 'rule' as const,
  };
}
