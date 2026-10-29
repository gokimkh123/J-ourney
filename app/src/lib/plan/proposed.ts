import type { MeetingState, RouteDay, RouteStop } from '../meeting/types.ts';

export type PlanLabel = 'A' | 'B';

/** 서버가 보낸 일정안(plan.proposed) 하나. 가짜 회의처럼 라벨이 없는 안은 고르기 대상이 아니다. */
export type ProposedPlan = { planId: string; label: PlanLabel; route: RouteDay[]; notes: string[] };

export type PlanChoice = {
  planId: string;
  label: PlanLabel;
  /** "2시간 10분". 길찾기를 못 한 구간이 있으면 "2시간 10분+" */
  moveLabel: string;
  /** 카드에 보일 대표 장소 이름(최대 2) */
  places: string[];
};

export function proposedPlans(state: MeetingState): ProposedPlan[] {
  const plans: ProposedPlan[] = [];
  for (const [planId, plan] of Object.entries(state.plans)) {
    if (plan.label === undefined) continue;
    plans.push({ planId, label: plan.label, route: plan.route, notes: plan.notes ?? [] });
  }
  return plans.sort((a, b) => a.label.localeCompare(b.label));
}

function stopsOf(route: RouteDay[]): RouteStop[] {
  return [...route].sort((a, b) => a.day - b.day).flatMap((day) => day.stops);
}

function keyOf(stop: RouteStop): string {
  return stop.placeId ?? stop.name;
}

/** 일정 전체의 이동 시간(분). 길찾기를 못 한 구간이 있으면 approx. */
export function moveMinutesOf(route: RouteDay[]): { minutes: number; approx: boolean } {
  let minutes = 0;
  let approx = false;
  for (const day of route) {
    if (day.summary !== undefined) {
      minutes += day.summary.moveMinutes;
      if (day.summary.unknownLegs > 0) approx = true;
      continue;
    }
    for (const stop of day.stops) {
      const leg = stop.moveFromPrev;
      if (leg === null || leg === undefined) continue;
      if (leg.minutes === null) approx = true;
      else minutes += leg.minutes;
    }
  }
  return { minutes, approx };
}

export function durationLabel(minutes: number, approx = false): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const text = hours === 0 ? `${rest}분` : rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
  return approx ? `${text}+` : text;
}

/** 이 안에만 있는 관광지를 일정 순서대로 먼저, 모자라면 이 안의 다른 관광지로 채운다. */
function representativeNames(plan: ProposedPlan, others: ProposedPlan[]): string[] {
  const otherKeys = new Set(others.flatMap((o) => stopsOf(o.route).map(keyOf)));
  const sights = stopsOf(plan.route).filter((s) => s.kind === undefined || s.kind === 'sight');
  const ordered = [...sights.filter((s) => !otherKeys.has(keyOf(s))), ...sights.filter((s) => otherKeys.has(keyOf(s)))];
  const names: string[] = [];
  for (const stop of ordered) {
    if (!names.includes(stop.name)) names.push(stop.name);
    if (names.length === 2) break;
  }
  return names;
}

export function planChoices(state: MeetingState): PlanChoice[] {
  return choicesOf(proposedPlans(state));
}

/** 두 안의 카드 요약(이동 시간·대표 장소). 일정 표(GET /plan)의 안에도 쓴다. */
export function choicesOf(plans: ProposedPlan[]): PlanChoice[] {
  return plans.map((plan) => {
    const { minutes, approx } = moveMinutesOf(plan.route);
    return {
      planId: plan.planId,
      label: plan.label,
      moveLabel: minutes === 0 && approx ? '정보 없음' : durationLabel(minutes, approx),
      places: representativeNames(plan, plans.filter((p) => p.planId !== plan.planId)),
    };
  });
}

/** 서버가 보낸 안내 중 첫 줄(나머지는 "외 N건"). 없으면 null. */
export function noticeOf(plan: ProposedPlan | undefined): string | null {
  if (plan === undefined || plan.notes.length === 0) return null;
  const first = plan.notes[0]!;
  return plan.notes.length > 1 ? `${first} (외 ${plan.notes.length - 1}건)` : first;
}
