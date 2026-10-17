// 여행 날짜 고르기용 순수 함수. 날짜는 모두 'YYYY-MM-DD' 글자이고, 계산은 UTC 기준 일수로 한다(기기 시간대에 영향받지 않음).

export type DateRange = { start: string | null; end: string | null };

/** 여행은 최대 7일(출발일 + 6일)까지. validateConditions의 MAX_SPAN_DAYS와 같은 값. */
export const MAX_TRIP_DAYS = 7;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86400000;
}

function fromDayNumber(day: number): string {
  const date = new Date(day * 86400000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 기기에 맞춘 오늘 날짜(현지 기준). */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0=일 … 6=토 */
export function weekdayIndex(iso: string): number {
  return new Date(toDayNumber(iso) * 86400000).getUTCDay();
}

export function weekdayKo(iso: string): string {
  return WEEKDAYS[weekdayIndex(iso)]!;
}

/** "11월 14일 (토)" */
export function dateLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}월 ${d}일 (${weekdayKo(iso)})`;
}

export function monthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 일요일부터 시작하는 달력 칸. 달 밖의 칸은 null. 주마다 7칸. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = `${year}-${pad(month)}-01`;
  const lead = weekdayIndex(first);
  const length = daysInMonth(year, month);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function daysInMonth(year: number, month: number): number {
  const next = shiftMonth(year, month, 1);
  return daysBetween(`${year}-${pad(month)}-01`, `${next.year}-${pad(next.month)}-01`);
}

/** 오늘 이후이고, 출발일만 골라 둔 상태에서는 출발일 + 6일 안쪽인 날만 고를 수 있다. */
export function isSelectable(range: DateRange, iso: string, today: string): boolean {
  if (iso < today) return false;
  if (range.start !== null && range.end === null) {
    const gap = daysBetween(range.start, iso);
    if (gap > MAX_TRIP_DAYS - 1) return false;
  }
  return true;
}

/**
 * 날짜를 한 번 누를 때마다 범위를 어떻게 바꿀지.
 * - 아무것도 없거나 이미 둘 다 골랐으면: 새 출발일(도착일 비움)
 * - 출발일만 있고 그보다 이른 날을 누르면: 새 출발일
 * - 그 외: 도착일(출발일과 같은 날이면 당일치기)
 */
export function pickDate(range: DateRange, tapped: string): DateRange {
  if (range.start === null || range.end !== null) return { start: tapped, end: null };
  if (tapped < range.start) return { start: tapped, end: null };
  return { start: range.start, end: tapped };
}

/** 오늘로부터 minDaysAhead일 이후 첫 토요일. 기본 일정(토~일) 초깃값에 쓴다. */
export function nextSaturday(today: string, minDaysAhead = 7): string {
  const from = addDays(today, minDaysAhead);
  return addDays(from, (6 - weekdayIndex(from) + 7) % 7);
}
