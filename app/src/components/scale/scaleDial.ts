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

// 부푼 띠 모양(11/3 시안 ⑤-2): 칸 대신 하나로 이어진 띠가 점수 자리마다 바깥쪽으로 살짝 부풀고, 사이는 평평하다.
// 부푼 곳과 평평한 곳은 cos² 모양으로 매끈하게 이어진다. 고른 자리는 부푼 두께에 딱 맞는 동그라미로 칠한다.
/** 띠 가운데 반지름(칸 숫자와 같은 자리) */
export const BAND_R = (R_OUT + R_IN) / 2;
/** 평평한 곳의 띠 절반 두께 */
const BAND_HALF = 9;
/** 부푸는 정도와 바깥·안쪽 나눔(바깥 8, 안쪽 2) */
const BULGE = 5;
const BULGE_OUT = 1.6;
const BULGE_IN = 0.4;
/** 한 칸 각도 중 부푸는 폭(가운데에서 양쪽으로) */
const BULGE_SPAN = 0.46;

/** deg(그림 각도) 자리에서 부푼 정도 0~1 */
function bulgeAt(deg: number, n: number): number {
  const step = SWEEP_DEG / n;
  const k = (deg - START_DEG) / step - 0.5;
  const i = Math.round(k);
  const d = Math.abs(k - i) * step;
  const hw = step * BULGE_SPAN;
  if (i < 0 || i > n - 1 || d >= hw) return 0;
  return Math.cos(((Math.PI / 2) * d) / hw) ** 2;
}

/** i번째 칸 가운데 각도 */
export function slotDeg(i: number, n: number): number {
  return START_DEG + ((i + 0.5) * SWEEP_DEG) / n;
}

/** fromDeg~toDeg 구간의 부푼 띠 path(양 끝은 둥글게). 띠 전체는 bandPath(slotDeg(0), slotDeg(n-1), n). */
export function bandPath(fromDeg: number, toDeg: number, n: number): string {
  const steps = Math.max(2, Math.ceil((toDeg - fromDeg) / 0.6));
  const outer: { x: number; y: number }[] = [];
  const inner: { x: number; y: number }[] = [];
  for (let s = 0; s <= steps; s++) {
    const deg = fromDeg + ((toDeg - fromDeg) * s) / steps;
    const b = bulgeAt(deg, n) * BULGE;
    outer.push(pt(BAND_R + BAND_HALF + b * BULGE_OUT, deg));
    inner.push(pt(BAND_R - BAND_HALF - b * BULGE_IN, deg));
  }
  const xy = (p: { x: number; y: number }) => `${f(p.x)} ${f(p.y)}`;
  const last = inner[inner.length - 1]!;
  return (
    `M${xy(outer[0]!)}` +
    outer.slice(1).map((p) => `L${xy(p)}`).join('') +
    `A${BAND_HALF} ${BAND_HALF} 0 0 1 ${xy(last)}` +
    inner.slice(0, -1).reverse().map((p) => `L${xy(p)}`).join('') +
    `A${BAND_HALF} ${BAND_HALF} 0 0 1 ${xy(outer[0]!)}Z`
  );
}

/** 고른 칸 동그라미: 부푼 곳의 바깥 끝~안쪽 끝에 딱 맞는다. */
export function pickedCircle(i: number, n: number): { x: number; y: number; r: number } {
  const out = BAND_HALF + BULGE * BULGE_OUT;
  const inn = BAND_HALF + BULGE * BULGE_IN;
  const c = pt(BAND_R + (out - inn) / 2, slotDeg(i, n));
  return { x: f(c.x), y: f(c.y), r: (out + inn) / 2 };
}
