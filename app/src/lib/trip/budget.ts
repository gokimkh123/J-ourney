// 1인당 예산 슬라이더용 순수 함수. 1만 원 ~ 1,000만 원을 로그 눈금으로 펼쳐서 작은 금액도 고르기 쉽게 한다.

export const MIN_BUDGET = 10_000;
export const MAX_BUDGET = 10_000_000;
export const DEFAULT_BUDGET = 300_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 금액 크기에 따라 달라지는 눈금: 10만 원 미만 1만, 100만 원 미만 5만, 그 이상 50만 원 단위. */
export function budgetStep(value: number): number {
  if (value < 100_000) return 10_000;
  if (value < 1_000_000) return 50_000;
  return 500_000;
}

/** 가장 가까운 눈금으로 맞추고 범위 안에 넣는다. 눈금이 아닌 금액(예: 30만)도 그 눈금이면 그대로 둔다. */
export function snapBudget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BUDGET;
  const clamped = clamp(value, MIN_BUDGET, MAX_BUDGET);
  const step = budgetStep(clamped);
  return clamp(Math.round(clamped / step) * step, MIN_BUDGET, MAX_BUDGET);
}

/** 0~1 위치 → 금액 */
export function budgetFromRatio(ratio: number): number {
  const r = clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1);
  return snapBudget(MIN_BUDGET * Math.pow(MAX_BUDGET / MIN_BUDGET, r));
}

/** 금액 → 0~1 위치 */
export function ratioFromBudget(value: number): number {
  const v = clamp(Number.isFinite(value) ? value : MIN_BUDGET, MIN_BUDGET, MAX_BUDGET);
  return Math.log(v / MIN_BUDGET) / Math.log(MAX_BUDGET / MIN_BUDGET);
}

/** 눈금 한 칸 위/아래(접근성 증감 동작용) */
export function stepBudget(value: number, direction: 1 | -1): number {
  const current = snapBudget(value);
  const step = direction === 1 ? budgetStep(current) : budgetStep(current - 1);
  return snapBudget(current + direction * step);
}
