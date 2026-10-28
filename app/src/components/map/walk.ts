// 캐릭터가 걷는 시간. 거리에 비례하고 너무 짧거나 길지 않게 제한한다. speed가 클수록 빨리 걷는다(밀린 핀을 따라잡을 때).
export const WALK_PX_PER_MS = 0.09;
export const WALK_MIN_MS = 450;
export const WALK_MAX_MS = 2800;

export function walkMs(distancePx: number, speed = 1): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const d = Number.isFinite(distancePx) && distancePx > 0 ? distancePx : 0;
  return Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, d / WALK_PX_PER_MS)) / s;
}
