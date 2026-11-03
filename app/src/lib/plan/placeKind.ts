import type { PlaceKind } from '../../components/PlaceSticker.tsx';

const KINDS: Record<string, PlaceKind> = {
  food: 'food',
  cafe: 'cafe',
  market: 'market',
  sightseeing: 'view',
  walk: 'beach',
};

// 실서버 분류는 관광공사 한글 이름(해수욕장·재래시장·카페 …)이라 들어 있는 말로 고른다. 앞에서부터 먼저 맞는 것(해안절경 → 바다).
const WORDS: [PlaceKind, string[]][] = [
  ['cafe', ['카페', '찻집', '커피', '디저트', '베이커리', '제과']],
  ['food', ['식당', '음식', '한식', '중식', '일식', '양식', '분식', '국밥', '횟집', '맛집']],
  ['market', ['시장', '쇼핑', '상가', '백화점', '아울렛', '면세']],
  ['beach', ['해수욕장', '해변', '해안', '항구', '포구', '섬', '등대', '바다']],
  ['view', ['전망', '타워', '공원', '산', '사찰', '유적', '박물관', '미술관', '기념관', '문화', '마을', '다리', '궁', '성곽', '야경']],
];

/** 일정 분류(food, cafe 등, 실서버는 한글 이름) → 스티커 모양. 모르는 분류는 기본 핀. */
export function placeKindOf(category: string): PlaceKind {
  if (Object.hasOwn(KINDS, category)) return KINDS[category]!;
  for (const [kind, words] of WORDS) {
    if (words.some((word) => category.includes(word))) return kind;
  }
  return 'pin';
}

/** 회의 후보(v2.4 kind·category) → 스티커 모양. 숙소는 기본 핀, 음식점은 카페가 아니면 음식, 예전 서버(둘 다 없음)는 기본 핀. */
export function candidateKindOf(kind: 'sight' | 'food' | 'lodging' | undefined, category: string | null | undefined): PlaceKind {
  if (kind === 'lodging') return 'pin';
  const byCategory = placeKindOf(category ?? '');
  if (kind === 'food') return byCategory === 'cafe' ? 'cafe' : 'food';
  return byCategory;
}
