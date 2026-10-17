/** 시트를 놓았을 때 어디에 자리 잡을지 정하는 규칙. 속도(vy, px/ms, 아래로 갈수록 +)가 빠르면 쓸어 넘긴 방향을 따르고, 느리면 가까운 쪽에 붙는다. */
export const FLING_SPEED = 0.4;

export function clampSheetHeight(height: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, height));
}

export function settleCollapsed(args: { height: number; min: number; max: number; vy: number }): boolean {
  const { height, min, max, vy } = args;
  if (Math.abs(vy) >= FLING_SPEED) return vy > 0;
  return height < (min + max) / 2;
}
