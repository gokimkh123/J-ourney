import { useCallback, useMemo, useState } from 'react';

import type { MeetingState, RouteDay } from '../meeting/types.ts';
import { membersOf } from '../meeting/view.ts';
import { chosenPlanStore, dayOfKey, dayRows, routeDayTabs } from './chosenPlan.ts';
import type { PlanChoiceCard, PlanChoiceStop } from '../../components/PlanChoice.tsx';
import { noticeOf, planChoices, proposedPlans } from './proposed.ts';

export type PlanChoiceView = {
  cards: PlanChoiceCard[];
  selected: string;
  select: (label: string) => void;
  dayTabs: { key: string; label: string }[];
  day: string;
  setDay: (key: string) => void;
  notice: string | null;
  stops: PlanChoiceStop[];
  /** 고른 안의 전체 경로(지도에 그린다) */
  route: RouteDay[];
  confirm: () => void;
};

/** 회의에서 나온 A·B 안 중 하나를 고르는 상태. enabled가 켜져 있고 고를 안이 있으면 view를, 아니면 null을 돌려준다. */
export function usePlanChoice(state: MeetingState, enabled: boolean, fallbackColor: string): PlanChoiceView | null {
  const [picked, setPicked] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  const plans = useMemo(() => proposedPlans(state), [state]);
  const cards = useMemo(() => planChoices(state).map(({ label, moveLabel, places }) => ({ label, moveLabel, places })), [state]);
  const members = useMemo(() => membersOf(state), [state]);

  const plan = plans.find((p) => p.label === picked) ?? plans[0];
  const tabs = useMemo(() => (plan === undefined ? [] : routeDayTabs(plan.route)), [plan]);
  const day = tabs.find((t) => t.key === dayKey)?.key ?? tabs[0]?.key ?? '';

  const confirm = useCallback(() => {
    if (plan === undefined) return;
    chosenPlanStore.set({ planId: plan.planId, route: plan.route, members });
  }, [plan, members]);

  if (!enabled || plan === undefined) return null;

  const rows = dayRows({ route: plan.route, members }, dayOfKey(day), fallbackColor);
  const stops = rows.map((row, i) => ({
    itemId: row.itemId,
    number: i + 1,
    title: row.title,
    sub: row.forMembers.length > 0 ? `${row.category} · ${row.forMembers.map((m) => m.name).join(', ')}` : row.category,
    ...(row.moveLabel !== undefined && { moveLabel: row.moveLabel }),
    color: row.color,
  }));

  return {
    cards,
    selected: plan.label,
    select: setPicked,
    dayTabs: tabs,
    day,
    setDay: setDayKey,
    notice: noticeOf(plan),
    stops,
    route: plan.route,
    confirm,
  };
}
