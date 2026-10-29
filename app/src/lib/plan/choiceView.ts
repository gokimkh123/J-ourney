import type { MemberRef } from '../meeting/view.ts';
import type { PlanBoard } from './board.ts';
import type { ProposedPlan } from './proposed.ts';

/** 회의 뒤 A·B 고르기(명세 v2.3, B3) 화면의 단계. choose 내가 아직 안 고름 · waiting 나는 골랐고 다른 사람을 기다림 · decided 정해짐 */
export type ChoiceStage = 'choose' | 'waiting' | 'decided';

export function choiceStage(board: PlanBoard | null, myMemberId: string): ChoiceStage | null {
  if (board === null) return null;
  if (board.choice.chosen !== null) return 'decided';
  if (board.status !== 'choosing') return null;
  return board.choice.votes.some((v) => v.memberId === myMemberId) ? 'waiting' : 'choose';
}

/** 일정 표의 두 안(A·B 순서). 화면 이름은 서버가 지은 이름(title). */
export function boardPlans(board: PlanBoard): (ProposedPlan & { title: string })[] {
  return [...board.candidates]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((c) => ({ planId: c.planId, label: c.label, title: c.title, route: c.plan.route, notes: c.plan.notes }));
}

/** 내가 고른 안(없으면 null) */
export function myChoice(board: PlanBoard, myMemberId: string): string | null {
  return board.choice.votes.find((v) => v.memberId === myMemberId)?.planId ?? null;
}

export type ChoicePerson = MemberRef & { done: boolean; me: boolean };

/** 구성원마다 골랐는지(무엇을 골랐는지는 정해질 때까지 보이지 않는다). 순서는 회의의 구성원 순서. */
export function choicePeople(board: PlanBoard, members: MemberRef[], myMemberId: string): ChoicePerson[] {
  const done = new Set(board.choice.votes.map((v) => v.memberId));
  return members.map((m) => ({ ...m, done: done.has(m.memberId), me: m.memberId === myMemberId }));
}

export type ChoiceResult = {
  title: string;
  /** 제목 위 작은 글: 보통 "정했어요", 같은 수일 때는 까닭 */
  head: string;
  rows: { name: string; votes: number; win: boolean }[];
  /** 같은 수라 방장이 고른 안으로 정해졌으면 그 줄에 "방장" 표시 */
  hostPick: boolean;
};

export function choiceResult(board: PlanBoard, hostMemberId: string | null): ChoiceResult | null {
  const chosen = board.choice.chosen;
  if (chosen === null) return null;
  const plans = boardPlans(board);
  const title = plans.find((p) => p.planId === chosen.planId)?.title ?? `${chosen.label}안`;
  const hostVote = hostMemberId === null ? null : myChoice(board, hostMemberId);
  const hostPick = chosen.tie && hostVote === chosen.planId;
  const head = !chosen.tie
    ? '정했어요'
    : hostPick
      ? `${chosen.votes.A}:${chosen.votes.B}라서 방장이 고른 안으로 정했어요`
      : '표가 같아서 AI가 더 만족한 안으로 정했어요';
  return {
    title,
    head,
    rows: plans.map((p) => ({ name: p.title, votes: chosen.votes[p.label], win: p.planId === chosen.planId })),
    hostPick,
  };
}

/**
 * 시연 모드(방장 폰 한 대)에서 방장이 고른 뒤 다른 구성원 몫으로 대신 낼 선택. 아직 안 고른 사람만, 구성원 순서대로.
 * 표가 갈리는 모습이 보이게 다른 구성원이 둘 이상이면 마지막 한 명은 다른 안, 나머지는 방장과 같은 안(4명이면 3:1).
 */
export function demoChoices(board: PlanBoard, members: MemberRef[], hostMemberId: string): { memberId: string; planId: string }[] {
  if (board.status !== 'choosing' || board.choice.chosen !== null) return [];
  const hostPlan = myChoice(board, hostMemberId);
  if (hostPlan === null) return [];
  const otherPlan = board.candidates.find((c) => c.planId !== hostPlan)?.planId ?? hostPlan;
  const others = members.filter((m) => m.memberId !== hostMemberId);
  const voted = new Set(board.choice.votes.map((v) => v.memberId));
  return others
    .map((m, i) => ({ memberId: m.memberId, planId: others.length >= 2 && i === others.length - 1 ? otherPlan : hostPlan }))
    .filter((c) => !voted.has(c.memberId));
}
