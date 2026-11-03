export type ConditionsInput = {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: string | number;
  transport: string;
  /** 없으면 기본값(7점·5회). 화면의 스테퍼가 바꾼다. */
  aiMinSatisfaction?: number;
  maxRounds?: number;
  /** 방장 칸(v2.4, 모두 선택): 첫날 도착·마지막 날 출발 시각(HH:MM), 이미 예약한 숙소·장소 */
  arrivalTime?: string | null;
  departureTime?: string | null;
  bookedLodging?: string | null;
  bookedPlaces?: string[];
};

export type ConditionsField = keyof ConditionsInput;

export type ConditionsBody = {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: number;
  transport: string;
  rules: { aiMinSatisfaction: number; maxRounds: number };
  // 방장 칸(v2.4): 값이 있을 때만 싣는다(서버는 없으면 null·빈 목록으로 본다).
  arrivalTime?: string;
  departureTime?: string;
  bookedLodging?: string;
  bookedPlaces?: string[];
  /** 이 폰에만: 예약한 장소의 날짜·시각(bookedPlaces와 같은 순서). 서버는 이름만 받아 보내지 않는다(serverConditions) */
  bookedPlaceTimes?: { date: string; time: string }[];
};

export type ConditionsResult =
  | { ok: true; body: ConditionsBody }
  | { ok: false; errors: Partial<Record<ConditionsField, string>> };

const MAX_DESTINATION = 20;
const MAX_TRANSPORT = 40;
const MIN_BUDGET = 10000;
const MAX_BUDGET = 10000000;
const MAX_SPAN_DAYS = 6;
/** 방장 칸 한도(서버 v2.4 routes/trips.ts BOOKED와 같음) */
export const BOOKED_LIMITS = { places: 3, nameMax: 40 } as const;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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

  const arrivalTime = input.arrivalTime ?? null;
  const departureTime = input.departureTime ?? null;
  if (arrivalTime !== null && !HHMM.test(arrivalTime)) errors.arrivalTime = '도착 시각을 다시 골라 주세요.';
  if (departureTime !== null && !HHMM.test(departureTime)) errors.departureTime = '출발 시각을 다시 골라 주세요.';
  // 당일치기는 도착이 출발보다 앞이어야 한다(서버 규칙).
  if (
    errors.arrivalTime === undefined &&
    errors.departureTime === undefined &&
    arrivalTime !== null &&
    departureTime !== null &&
    input.startDate === input.endDate &&
    arrivalTime >= departureTime
  ) {
    errors.departureTime = '당일치기는 도착 시각이 출발 시각보다 앞이어야 해요.';
  }
  // 빈 칸은 없는 것으로 본다(숙소 '있어요'를 골랐는데 비어 있으면 없음).
  const bookedLodging = (input.bookedLodging ?? '').trim();
  if (Array.from(bookedLodging).length > BOOKED_LIMITS.nameMax) {
    errors.bookedLodging = `예약한 숙소 이름은 ${BOOKED_LIMITS.nameMax}자까지 적을 수 있어요.`;
  }
  const bookedPlaces = (input.bookedPlaces ?? []).map((name) => name.trim()).filter((name) => name !== '');
  if (bookedPlaces.length > BOOKED_LIMITS.places) {
    errors.bookedPlaces = `예약한 장소는 ${BOOKED_LIMITS.places}곳까지 적을 수 있어요.`;
  } else if (bookedPlaces.some((name) => Array.from(name).length > BOOKED_LIMITS.nameMax)) {
    errors.bookedPlaces = `장소 이름은 ${BOOKED_LIMITS.nameMax}자까지 적을 수 있어요.`;
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
      ...(arrivalTime !== null && { arrivalTime }),
      ...(departureTime !== null && { departureTime }),
      ...(bookedLodging !== '' && { bookedLodging }),
      ...(bookedPlaces.length > 0 && { bookedPlaces }),
    },
  };
}
