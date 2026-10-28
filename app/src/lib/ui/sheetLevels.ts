import { FLING_SPEED } from './sheetSnap.ts';

/**
 * 높이 단계가 셋 이상인 시트(접힘·중간·펼침)를 놓았을 때 어느 단계에 붙을지 정한다.
 * levels는 낮은 순서대로. 속도(vy, px/ms, 아래로 갈수록 +)가 빠르면 쓸어 넘긴 방향의 이웃 단계로, 느리면 가장 가까운 단계로 붙는다.
 * 돌려주는 값은 levels의 위치(인덱스)다.
 */
export function settleLevel(args: { height: number; levels: number[]; vy: number }): number {
  const { height, levels, vy } = args;
  const last = levels.length - 1;
  if (last <= 0) return 0;
  if (Math.abs(vy) >= FLING_SPEED) {
    // 지금 높이 바로 아래(같으면 그 단계) 위치. 아래로 쓸면 거기로, 위로 쓸면 한 칸 위로.
    let lower = 0;
    for (let i = 0; i <= last; i++) if (levels[i] <= height) lower = i;
    if (vy > 0) return height > levels[lower] ? lower : Math.max(0, lower - 1);
    return Math.min(last, lower + 1);
  }
  let best = 0;
  for (let i = 1; i <= last; i++) {
    if (Math.abs(levels[i] - height) < Math.abs(levels[best] - height)) best = i;
  }
  return best;
}
