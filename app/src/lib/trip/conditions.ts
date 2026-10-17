export type ConditionsInput = {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: string | number;
  transport: string;
  /** 없으면 기본값(7점·5회). 화면의 스테퍼가 바꾼다. */
  aiMinSatisfaction?: number;
  maxRounds?: number;
};

export type ConditionsField = keyof ConditionsInput;

export type ConditionsBody = {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: number;
  transport: string;
  rules: { aiMinSatisfaction: number; maxRounds: number };
};

export type ConditionsResult =
  | { ok: true; body: ConditionsBody }
  | { ok: false; errors: Partial<Record<ConditionsField, string>> };

const MAX_DESTINATION = 20;
const MAX_TRANSPORT = 40;
const MIN_BUDGET = 10000;
const MAX_BUDGET = 10000000;
const MAX_SPAN_DAYS = 6;

/** 회의 규칙 기본값과 고를 수 있는 범위(서버 한도가 정해지면 맞춘다). */
export const DEFAULT_MIN_SATISFACTION = 7;
export const DEFAULT_MAX_ROUNDS = 5;
export const MIN_SATISFACTION_RANGE = { min: 5, max: 10 } as const;
export const MAX_ROUNDS_RANGE = { min: 1, max: 7 } as const;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

// YYYY-MM-DD가 실제 존재하는 날짜면 일련번호(정수 일수)를, 아니면 null을 돌려준다.
function dayNumber(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

function parseBudget(value: string | number): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const digits = value.trim().replace(/,/g, '');
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

export function validateConditions(input: ConditionsInput, today?: string): ConditionsResult {
  const errors: Partial<Record<ConditionsField, string>> = {};

  const destination = input.destination.trim();
  if (destination.length < 1 || destination.length > MAX_DESTINATION) {
    errors.destination = `여행지는 1~${MAX_DESTINATION}자로 입력해 주세요.`;
  }

  const transport = input.transport.trim();
  if (transport.length < 1 || transport.length > MAX_TRANSPORT) {
    errors.transport = `이동수단은 1~${MAX_TRANSPORT}자로 입력해 주세요.`;
  }

  const start = dayNumber(input.startDate);
  const end = dayNumber(input.endDate);
  if (start === null) errors.startDate = '출발일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.';
  if (end === null) errors.endDate = '도착일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.';
  if (start !== null && today !== undefined) {
    const base = dayNumber(today);
    if (base !== null && start < base) errors.startDate = '출발일은 오늘 이후여야 해요.';
  }
  if (start !== null && end !== null) {
    if (end < start) errors.endDate = '도착일은 출발일보다 이르면 안 돼요.';
    else if (end - start > MAX_SPAN_DAYS) errors.endDate = '여행 기간은 최대 7일까지 가능해요.';
  }

  const budget = parseBudget(input.budgetPerPerson);
  if (budget === null || budget < MIN_BUDGET || budget > MAX_BUDGET) {
    errors.budgetPerPerson = '1인당 예산은 1만 원 이상 1000만 원 이하의 숫자로 입력해 주세요.';
  }

  const aiMinSatisfaction = input.aiMinSatisfaction ?? DEFAULT_MIN_SATISFACTION;
  if (
    !Number.isInteger(aiMinSatisfaction) ||
    aiMinSatisfaction < MIN_SATISFACTION_RANGE.min ||
    aiMinSatisfaction > MIN_SATISFACTION_RANGE.max
  ) {
    errors.aiMinSatisfaction = `최소 만족도는 ${MIN_SATISFACTION_RANGE.min}~${MIN_SATISFACTION_RANGE.max}점 사이로 정해 주세요.`;
  }
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  if (!Number.isInteger(maxRounds) || maxRounds < MAX_ROUNDS_RANGE.min || maxRounds > MAX_ROUNDS_RANGE.max) {
    errors.maxRounds = `최대 라운드는 ${MAX_ROUNDS_RANGE.min}~${MAX_ROUNDS_RANGE.max}회 사이로 정해 주세요.`;
  }

  if (Object.keys(errors).length > 0 || budget === null) return { ok: false, errors };
  return {
    ok: true,
    body: {
      destination,
      startDate: input.startDate,
      endDate: input.endDate,
      budgetPerPerson: budget,
      transport,
      rules: { aiMinSatisfaction, maxRounds },
    },
  };
}
