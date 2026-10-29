import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlanCard } from '../../components/PlanCards.tsx';
import type { PlanChoicePerson, PlanChoiceStop } from '../../components/PlanChoice.tsx';
import type { MeetingState, RouteDay } from '../meeting/types.ts';
import { membersOf } from '../meeting/view.ts';
import type { Session } from '../session/session.ts';
import { chosenPlanStore, dayOfKey, dayRows, routeDayTabs } from './chosenPlan.ts';
import { boardPlans, choicePeople, choiceResult, choiceStage, demoChoices, myChoice } from './choiceView.ts';
import type { ChoicePerson, ChoiceResult } from './choiceView.ts';
import { choicesOf, noticeOf } from './proposed.ts';
import { usePlanBoard } from './usePlanBoard.ts';
import type { PlanBoardFlow } from './usePlanBoard.ts';

/** 시연 모드에서 구성원 몫을 대신 고르는 간격. 한 명씩 들어오는 모습이 보이게 한다(사람 확인과 같음). */
export const DEMO_CHOICE_GAP_MS = 2500;

type Common = { route: RouteDay[]; error: string | null; sending: boolean };

export type ServerChoiceView =
  | (Common & {
      stage: 'choose';
      cards: PlanCard[];
      selected: string | null;
      select(planId: string): void;
      people: PlanChoicePerson[];
      dayTabs: { key: string; label: string }[];
      day: string;
      setDay(key: string): void;
      notice: string | null;
      stops: PlanChoiceStop[];
      confirm(): void;
    })
  | (Common & {
      stage: 'waiting';
      cards: PlanCard[];
      mine: string | null;
      change(planId: string): void;
      people: ChoicePerson[];
      /** 방장만 */
      decide?: () => void;
    })
  | (Common & { stage: 'decided'; result: ChoiceResult });

/**
 * 회의가 끝난 뒤 A·B 고르기(명세 v2.3, B3)를 서버 일정 표로 진행한다. 실서버에서 meeting.agreed를 받은 뒤에만 켜진다.
 * 정해지면 고른 안을 일정 탭이 읽는 chosenPlanStore에도 넣는다(고치기 화면이 생기기 전까지 일정 탭은 그 값을 보여 준다).
 */
export function useServerChoice(
  state: MeetingState,
  enabled: boolean,
  session: Session | null,
  isHost: boolean,
  hostMemberId: string | null,
  fallbackColor: string,
): { view: ServerChoiceView | null; flow: PlanBoardFlow } {
  const tripId = session?.tripId ?? null;
  const myId = session?.memberId ?? '';
  const flow = usePlanBoard(enabled, tripId, state.lastSeq);
  const board = flow.board;
  const members = useMemo(() => membersOf(state), [state]);
  const [picked, setPicked] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const stage = enabled ? choiceStage(board, myId) : null;
  const plans = useMemo(() => (board === null ? [] : boardPlans(board)), [board]);
  const cards = useMemo(() => {
    const summary = choicesOf(plans);
    return plans.map((p, i) => ({ planId: p.planId, name: p.title, moveLabel: summary[i]!.moveLabel, places: summary[i]!.places }));
  }, [plans]);
  const mine = board === null ? null : myChoice(board, myId);

  const send = useCallback(
    async (action: () => Promise<unknown>) => {
      flow.clearNotice();
      setSending(true);
      try {
        await action();
      } finally {
        setSending(false);
      }
    },
    [flow],
  );
  const choose = useCallback((planId: string) => void send(() => flow.choose(planId)), [send, flow]);

  // 정해진 안(고치면 version이 오른다)을 일정 탭이 읽는 곳에 넣는다. 폴링마다 같은 값을 다시 넣지 않는다.
  const putKey = useRef('');
  const chosenPlan = board?.plan ?? null;
  useEffect(() => {
    if (!enabled || chosenPlan === null) return;
    const key = `${chosenPlan.planId}@${chosenPlan.version}`;
    if (putKey.current === key) return;
    putKey.current = key;
    chosenPlanStore.set({ planId: chosenPlan.planId, route: chosenPlan.route, members });
  }, [enabled, chosenPlan, members]);

  // 시연 모드: 방장이 고르면 다른 구성원 몫을 간격을 두고 대신 낸다(3:1로 갈리게).
  const demo = session?.demo === true && isHost;
  const autoSent = useRef(new Set<string>());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!demo || board === null) return;
    const next = demoChoices(board, members, myId).find((c) => !autoSent.current.has(c.memberId));
    if (next === undefined) return;
    const timer = setTimeout(() => {
      autoSent.current.add(next.memberId);
      void flow.choose(next.planId, next.memberId).then((r) => {
        if (r.ok) return;
        autoSent.current.delete(next.memberId);
        if (r.code === 'BUSY') setRetry((n) => n + 1);
      });
    }, DEMO_CHOICE_GAP_MS);
    return () => clearTimeout(timer);
  }, [demo, board, members, myId, flow, retry]);

  if (stage === null || board === null) return { view: null, flow };
  const error = flow.notice;

  if (stage === 'decided') {
    const result = choiceResult(board, hostMemberId);
    const route = plans.find((p) => p.planId === board.choice.chosen?.planId)?.route ?? [];
    return { view: result === null ? null : { stage, result, route, error, sending }, flow };
  }

  if (stage === 'waiting') {
    const route = plans.find((p) => p.planId === mine)?.route ?? [];
    return {
      view: {
        stage,
        cards,
        mine,
        change: (planId) => {
          if (planId !== mine) choose(planId);
        },
        people: choicePeople(board, members, myId),
        ...(isHost && { decide: () => void send(() => flow.closeChoice()) }),
        route,
        error,
        sending,
      },
      flow,
    };
  }

  const plan = plans.find((p) => p.planId === picked) ?? plans[0];
  const tabs = plan === undefined ? [] : routeDayTabs(plan.route);
  const day = tabs.find((t) => t.key === dayKey)?.key ?? tabs[0]?.key ?? '';
  const rows = plan === undefined ? [] : dayRows({ route: plan.route, members }, dayOfKey(day), fallbackColor);
  return {
    view: {
      stage,
      cards,
      selected: plan?.planId ?? null,
      select: setPicked,
      people: choicePeople(board, members, myId),
      dayTabs: tabs,
      day,
      setDay: setDayKey,
      notice: plan === undefined ? null : noticeOf(plan),
      stops: rows.map((row, i) => ({
        itemId: row.itemId,
        number: i + 1,
        title: row.title,
        sub: row.forMembers.length > 0 ? `${row.category} · ${row.forMembers.map((m) => m.name).join(', ')}` : row.category,
        ...(row.moveLabel !== undefined && { moveLabel: row.moveLabel }),
        color: row.color,
      })),
      confirm: () => {
        if (plan !== undefined) choose(plan.planId);
      },
      route: plan?.route ?? [],
      error,
      sending,
    },
    flow,
  };
}
