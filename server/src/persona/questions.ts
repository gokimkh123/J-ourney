import type { TraitKey } from './types.js';

/**
 * 여행 성향 6가지와 근거 척도
 * - 계획: IPIP-NEO 질서·신중성 / 속도: 활동성 / 분위기: 사교성·자극 추구 / 장소: 모험성
 * - 하루 시작: 아침형-저녁형 질문지(MEQ) / 예산: 가격 의식·절약 성향 개념
 * low = 0–3점 쪽, high = 7–10점 쪽 (순서는 칩 동점 처리에도 씀)
 */
export const TRAITS: readonly {
  key: TraitKey;
  name: string;
  low: { label: string; emoji: string };
  high: { label: string; emoji: string };
}[] = [
  { key: 'plan', name: '계획', low: { label: '즉흥형', emoji: '🎲' }, high: { label: '계획형', emoji: '📋' } },
  { key: 'pace', name: '속도', low: { label: '느긋형', emoji: '🐢' }, high: { label: '부지런형', emoji: '🏃' } },
  { key: 'vibe', name: '분위기', low: { label: '한적형', emoji: '🌿' }, high: { label: '활기형', emoji: '🎉' } },
  { key: 'place', name: '장소', low: { label: '명소형', emoji: '📸' }, high: { label: '탐험형', emoji: '🧭' } },
  { key: 'start', name: '하루 시작', low: { label: '늦잠형', emoji: '😴' }, high: { label: '아침형', emoji: '🌅' } },
  { key: 'budget', name: '예산', low: { label: '절약형', emoji: '🐷' }, high: { label: '투자형', emoji: '💳' } },
];

export const SCALE_MIN = 0;
export const SCALE_MAX = 10;
export const NEUTRAL_LABEL = '상관없음';

/**
 * 1–12번 성향 문항: (+)는 high 쪽, (−)는 low 쪽 문장이며 점수를 뒤집어 계산함
 * 같은 성향의 두 문항은 붙이지 않음 (+ 1–6번, − 7–12번)
 */
export const SCALE_QUESTIONS: readonly { id: string; trait: TraitKey; reverse: boolean; text: string }[] = [
  { id: 'q1', trait: 'plan', reverse: false, text: '여행 가면 미리 세운 계획대로 움직인다' },
  { id: 'q2', trait: 'pace', reverse: false, text: '여행 중에는 쉬지 않고 여러 곳을 다니고 싶다' },
  { id: 'q3', trait: 'vibe', reverse: false, text: '사람들로 북적이는 활기찬 곳이 즐겁다' },
  { id: 'q4', trait: 'place', reverse: false, text: '남들이 잘 모르는 새로운 곳에 가 보고 싶다' },
  { id: 'q5', trait: 'start', reverse: false, text: '여행 가면 아침 일찍 일어나 하루를 시작하는 게 좋다' },
  { id: 'q6', trait: 'budget', reverse: false, text: '여행에서는 돈이 좀 들어도 하고 싶은 것은 하는 편이다' },
  { id: 'q7', trait: 'plan', reverse: true, text: '여행 일정은 그때그때 즉흥적으로 정하는 편이다' },
  { id: 'q8', trait: 'pace', reverse: true, text: '여행에서는 내 속도대로 느긋하게 다니는 게 좋다' },
  { id: 'q9', trait: 'vibe', reverse: true, text: '여행지에서도 붐비는 곳은 피하고 조용한 곳을 찾는다' },
  { id: 'q10', trait: 'place', reverse: true, text: '이미 유명하고 검증된 곳 위주로 가는 게 마음 편하다' },
  { id: 'q11', trait: 'start', reverse: true, text: '나는 아침형보다 저녁형에 가깝다' },
  { id: 'q12', trait: 'budget', reverse: true, text: '여행 경비를 아끼려고 더 싼 곳을 찾아보는 편이다' },
];

/**
 * 13번 좋아요: 보기마다 맞는 장소의 한국관광공사 공식 분류 코드 앞부분 (장소 이름·소개글의 글자는 보지 않음)
 * 2자리는 대분류 전체(NA 자연관광), 6자리는 소분류 묶음(NA0209 해변·해수욕장)
 */
export const LIKE_OPTIONS: readonly { id: string; text: string; emoji: string; codes: readonly string[] }[] = [
  { id: 'like_nature', text: '자연·풍경', emoji: '🌲', codes: ['NA'] },
  { id: 'like_sea', text: '바다', emoji: '🌊', codes: ['NA0207', 'NA0208', 'NA0209'] }, // 항구·포구, 해안절경, 해변·해수욕장
  { id: 'like_spa', text: '온천·스파', emoji: '♨️', codes: ['EX0501', 'EX0502'] }, // 온천·사우나·스파, 찜질방
  { id: 'like_history', text: '역사', emoji: '🏯', codes: ['HS'] },
  // 문화관광(VE) 중 랜드마크·문화거리/마을·전시시설만 (도서관·문화원·학교·경기장·교통시설·공연장(공연이 없으면 볼 것이 없음)·도시공원 등은 넣지 않음, 10/19 사용자 결정)
  { id: 'like_culture', text: '문화·전시', emoji: '🎨', codes: ['VE01', 'VE04', 'VE07'] },
  { id: 'like_festival', text: '축제·공연', emoji: '🎪', codes: ['EV'] },
  { id: 'like_experience', text: '체험', emoji: '🧪', codes: ['EX'] },
  { id: 'like_leisure', text: '레저·스포츠', emoji: '🏄', codes: ['LS'] },
  // 쇼핑(SH) 중 대형마트(SH03)·사후면세점(SH0403, 체인 매장이 대부분)은 넣지 않음 (10/19 사용자 결정)
  { id: 'like_shopping', text: '쇼핑', emoji: '🛍️', codes: ['SH01', 'SH02', 'SH0401', 'SH0402', 'SH05', 'SH06', 'SH07'] },
  { id: 'like_food', text: '맛집', emoji: '🍽️', codes: ['FD'] },
  { id: 'like_cafe', text: '카페', emoji: '☕', codes: ['FD05'] }, // 카페·찻집
  // 야경은 공식 분류가 없어 가장 가까운 타워·전망대만 둠 (밤 풍경 여부는 회의 LLM이 소개글로 판단)
  { id: 'like_night', text: '야경', emoji: '🌃', codes: ['VE0102'] },
];

/** 14번 싫어요: 데이터로 확인할 수 있는 조건만 둠 (codes: 걸리는 장소의 공식 분류 코드 앞부분) */
export const DISLIKE_OPTIONS: readonly { id: string; text: string; emoji: string; codes?: readonly string[] }[] = [
  { id: 'dislike_walk', text: '오래 걷기', emoji: '🚶', codes: ['NA01', 'NA04'] }, // 산·숲·계곡, 자연공원·휴양림·수목원
  { id: 'dislike_early', text: '이른 출발', emoji: '⏰' },
  { id: 'dislike_crowd', text: '붐비는 곳', emoji: '👥' },
  { id: 'dislike_pricey', text: '비싼 곳', emoji: '💸' },
  { id: 'dislike_longmove', text: '긴 이동', emoji: '🚌' },
  { id: 'dislike_queue', text: '줄 서는 맛집', emoji: '⏳' },
];

export const LIKE_SELECT = { min: 1, max: 5 } as const;
export const DISLIKE_SELECT = { min: 0, max: 3 } as const;
export const MUST_KEEP_MAX_LENGTH = 200;
export const LIKES_ID = 'q13';
export const DISLIKES_ID = 'q14';
export const MUST_KEEP_ID = 'q15';

/** GET /persona/questions 응답: 채점 정보(성향·방향)는 앱에 보내지 않음 */
export const PUBLIC_QUESTIONS = [
  ...SCALE_QUESTIONS.map((q, i) => ({
    id: q.id,
    order: i + 1,
    type: 'scale' as const,
    text: q.text,
    min: SCALE_MIN,
    max: SCALE_MAX,
    minLabel: '전혀 아니다',
    maxLabel: '매우 그렇다',
  })),
  {
    id: LIKES_ID,
    order: 13,
    type: 'multi' as const,
    text: '여행에서 좋아하는 것을 골라 주세요',
    minSelect: LIKE_SELECT.min,
    maxSelect: LIKE_SELECT.max,
    options: LIKE_OPTIONS.map(({ id, text, emoji }) => ({ id, text, emoji })),
  },
  {
    id: DISLIKES_ID,
    order: 14,
    type: 'multi' as const,
    text: '여행에서 싫은 것을 골라 주세요 (없으면 넘어가도 됨)',
    minSelect: DISLIKE_SELECT.min,
    maxSelect: DISLIKE_SELECT.max,
    options: DISLIKE_OPTIONS.map(({ id, text, emoji }) => ({ id, text, emoji })),
  },
  {
    id: MUST_KEEP_ID,
    order: 15,
    type: 'text' as const,
    text: '이번 여행에서 꼭 지켰으면 하는 것이 있나요?',
    required: false,
    maxLength: MUST_KEEP_MAX_LENGTH,
    placeholder: '예: 해산물은 꼭 먹고 싶어요, 밤 9시 전엔 숙소에 들어가요',
  },
];
