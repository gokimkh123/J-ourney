import type { PlaceKind } from '../../components/PlaceSticker.tsx';

const KINDS: Record<string, PlaceKind> = {
  food: 'food',
  cafe: 'cafe',
  market: 'market',
  sightseeing: 'view',
  walk: 'beach',
};

/** 일정 분류(food, cafe 등) → 스티커 모양. 모르는 분류는 기본 핀. */
export function placeKindOf(category: string): PlaceKind {
  return Object.hasOwn(KINDS, category) ? KINDS[category]! : 'pin';
}
