// 반원형 점수 고르기(ScaleDial)의 모양 계산. 그림 좌표는 DIAL_W x DIAL_H 안이다.
// 0번 칸은 왼쪽 아래, 마지막 칸은 오른쪽 아래이고 위쪽을 지나 시계 방향으로 놓인다(아래 90°는 비운다).
export const DIAL_W = 358;
export const DIAL_H = 318;
export const CX = DIAL_W / 2;
export const CY = 185;
/** 칸 바깥·안쪽 반지름 */
export const R_OUT = 168;
export const R_IN = 116;
/** 안쪽에 두르는 진해지는 호의 반지름 */
export const R_TICK = 104;
/** 시작 각도(그림 좌표, 0°=오른쪽, 시계 방향 증가)와 펼친 각도 */
export const START_DEG = 135;
export const SWEEP_DEG = 270;
/** 칸 사이 틈(도) */
const GAP_DEG = 1.6;

const rad = (d: number) => (d * Math.PI) / 180;
const pt = (r: number, deg: number) => ({ x: CX + r * Math.cos(rad(deg)), y: CY + r * Math.sin(rad(deg)) });
const f = (n: number) => Math.round(n * 100) / 100;

/** i번째(0부터) 칸이 차지하는 각도 범위(틈 제외) */
function span(i: number, n: number) {
  const step = SWEEP_DEG / n;
  return { a0: START_DEG + i * step + GAP_DEG / 2, a1: START_DEG + (i + 1) * step - GAP_DEG / 2 };
}

/** 칸 모양(도넛 한 조각) path */
export function sectorPath(i: number, n: number): string {
  const { a0, a1 } = span(i, n);
  const o0 = pt(R_OUT, a0);
  const o1 = pt(R_OUT, a1);
  const i1 = pt(R_IN, a1);
  const i0 = pt(R_IN, a0);
  return `M${f(o0.x)} ${f(o0.y)}A${R_OUT} ${R_OUT} 0 0 1 ${f(o1.x)} ${f(o1.y)}L${f(i1.x)} ${f(i1.y)}A${R_IN} ${R_IN} 0 0 0 ${f(i0.x)} ${f(i0.y)}Z`;
}

/** 안쪽 호 한 조각 path */
export function tickPath(i: number, n: number): string {
  const { a0, a1 } = span(i, n);
  const p0 = pt(R_TICK, a0);
  const p1 = pt(R_TICK, a1);
  return `M${f(p0.x)} ${f(p0.y)}A${R_TICK} ${R_TICK} 0 0 1 ${f(p1.x)} ${f(p1.y)}`;
}

/** 칸 숫자를 놓을 중심 */
export function labelPoint(i: number, n: number): { x: number; y: number } {
  const step = SWEEP_DEG / n;
  const p = pt((R_OUT + R_IN) / 2, START_DEG + (i + 0.5) * step);
  return { x: f(p.x), y: f(p.y) };
}

/** 안쪽 호가 점점 진해지는 정도(0.2~0.9) */
export function tickOpacity(i: number, n: number): number {
  return n <= 1 ? 0.9 : f(0.2 + (0.7 * i) / (n - 1));
}
