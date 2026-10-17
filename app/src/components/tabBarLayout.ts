// 탭바 폭 배분. react 무관 순수 함수.

/** 켜진 탭은 아이콘 + 라벨이 들어가서 다른 탭보다 넓다. */
export const FOCUSED_FLEX = 1.9;

/** focusedIndex가 범위 밖이면 전부 같은 폭. */
export function tabFlexes(count: number, focusedIndex: number): number[] {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  return Array.from({ length: n }, (_, i) => (i === focusedIndex ? FOCUSED_FLEX : 1));
}
