/** 성향 질문은 고르면 0.3초 뒤 다음 문항으로 넘어가고, 그 안에 같은 칸을 한 번 더 누르면 기다리지 않고 바로 넘긴다. */
export const DOUBLE_TAP_MS = 300;

export type LastTap = { key: string; at: number } | null;

/** 이번 누름(key = 문항 + 고른 값, at = ms)이 바로 앞 누름과 같은 칸을 window 안에 다시 누른 것인지 */
export function isDoubleTap(prev: LastTap, key: string, at: number, windowMs: number = DOUBLE_TAP_MS): boolean {
  return prev !== null && prev.key === key && at - prev.at >= 0 && at - prev.at <= windowMs;
}
