import type { ConditionsBody } from './conditions.ts';
import { dateLabel } from './dateRange.ts';
import { formatWon, nightsLabel } from '../ui/format.ts';

/** "부산 · 1박 2일 · 1인 300,000원 · 대중교통" 같은 한 줄 요약. */
export function conditionsSummary(body: ConditionsBody): string {
  return [body.destination, nightsLabel(body.startDate, body.endDate), `1인 ${formatWon(body.budgetPerPerson)}`, body.transport].join(' · ');
}

/** "11월 14일 (토) ~ 11월 15일 (일)". 당일이면 한 날짜만. */
export function conditionsDates(body: ConditionsBody): string {
  if (body.startDate === body.endDate) return dateLabel(body.startDate);
  return `${dateLabel(body.startDate)} ~ ${dateLabel(body.endDate)}`;
}
