import { categoryLabel, crowdLabel, formatWon, moveModeLabel } from '../ui/format.ts';
import type { MemberRef } from '../meeting/view.ts';
import type { Plan, PlanItem, PlanVoteDecision } from './types.ts';

const DECISION_LABELS: Record<PlanVoteDecision, string> = {
  approve: '찬성',
  revise: '수정 요청',
  reject: '반대',
  pending: '대기 중',
};

function costLabelOf(costPerPerson: number): string {
  return costPerPerson === 0 ? '무료' : formatWon(costPerPerson);
}

function memberOf(members: MemberRef[], memberId: string): MemberRef | undefined {
  return members.find((m) => m.memberId === memberId);
}

export function dayTabs(plan: Plan): { key: string; label: string }[] {
  return plan.days.map((d) => ({ key: `day-${d.day}`, label: `${d.day}일차` }));
}

export function scheduleRows(
  plan: Plan,
  day: number,
  members: MemberRef[],
): {
  itemId: string;
  time: string;
  title: string;
  category: string;
  costLabel: string;
  verified: boolean;
  forMembers: { name: string; color: string }[];
  moveLabel?: string;
}[] {
  const planDay = plan.days.find((d) => d.day === day);
  if (planDay === undefined) return [];
  return planDay.items.map((item) => {
    const forMembers = [];
    for (const memberId of item.forMembers) {
      const m = memberOf(members, memberId);
      if (m === undefined) continue;
      forMembers.push({ name: m.name, color: m.color });
    }
    const row = {
      itemId: item.id,
      time: item.startTime,
      title: item.title,
      category: categoryLabel(item.category),
      costLabel: costLabelOf(item.costPerPerson),
      verified: item.place.verified,
      forMembers,
    };
    const move = item.moveFromPrev;
    if (move === null) return row;
    const base = `${moveModeLabel(move.mode)} ${move.minutes}분`;
    const moveLabel = move.fareWon > 0 ? `${base} · ${formatWon(move.fareWon)}` : base;
    return { ...row, moveLabel };
  });
}

export function findItem(plan: Plan, itemId: string): PlanItem | undefined {
  for (const day of plan.days) {
    const found = day.items.find((item) => item.id === itemId);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function placeDetail(
  plan: Plan,
  itemId: string,
  members: MemberRef[],
): {
  title: string;
  category: string;
  costLabel: string;
  verified: boolean;
  rows: { label: string; value: string }[];
  reasons: { name: string; color: string; text: string }[];
  kakaoMapUrl: string;
  naverMapUrl: string;
} | null {
  const item = findItem(plan, itemId);
  if (item === undefined) return null;
  const place = item.place;
  const rows = [
    { label: '주소', value: place.address },
    { label: '영업시간', value: place.openHours ?? '정보 없음' },
  ];
  if (place.menu !== null) rows.push({ label: '메뉴', value: place.menu });
  rows.push(
    { label: '인기도', value: `${place.popularity}/100` },
    { label: '혼잡도', value: crowdLabel(place.crowd) },
  );
  const reasons = [];
  for (const reason of item.reasons) {
    const m = memberOf(members, reason.memberId);
    if (m === undefined) continue;
    reasons.push({ name: m.name, color: m.color, text: reason.text });
  }
  return {
    title: item.title,
    category: categoryLabel(item.category),
    costLabel: costLabelOf(item.costPerPerson),
    verified: place.verified,
    rows,
    reasons,
    kakaoMapUrl: place.links.kakaoMap,
    naverMapUrl: place.links.naverMap,
  };
}

export function planSummary(plan: Plan): {
  costLabel: string;
  budgetLabel: string;
  overBudget: boolean;
  itemCount: number;
  dayCount: number;
} {
  return {
    costLabel: formatWon(plan.costPerPerson),
    budgetLabel: `예산 ${formatWon(plan.budgetPerPerson)}`,
    overBudget: plan.costPerPerson > plan.budgetPerPerson,
    itemCount: plan.days.reduce((sum, d) => sum + d.items.length, 0),
    dayCount: plan.days.length,
  };
}

export function voteRows(
  plan: Plan,
  members: MemberRef[],
): { name: string; color: string; decision: PlanVoteDecision; label: string }[] {
  const rows = [];
  for (const vote of plan.votes) {
    const m = memberOf(members, vote.memberId);
    if (m === undefined) continue;
    rows.push({
      name: m.name,
      color: m.color,
      decision: vote.decision,
      label: DECISION_LABELS[vote.decision],
    });
  }
  return rows;
}
