import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { endpoints } from '../api/index.ts';
import { describeError } from '../ui/format.ts';
import { showToast } from '../ui/toast.ts';
import type { Session } from '../session/session.ts';
import type { ReviewChoice } from './serverMeeting.ts';
import { canSend, demoAnswers, hasAnswered, pendingNames, sendLabel, toChoices } from './reviewView.ts';
import type { ReviewPicks } from './reviewView.ts';
import type { MeetingState } from './types.ts';

/** 시연 모드에서 구성원 몫을 대신 보내는 간격. 한 명씩 들어오는 모습이 보이게 한다. */
export const DEMO_ANSWER_GAP_MS = 2500;

export type ReviewFlow = {
  picks: ReviewPicks;
  pick(placeId: string, keep: boolean): void;
  canSend: boolean;
  sendLabel: string;
  submitting: boolean;
  /** 내가 이미 보냈는가 */
  sent: boolean;
  submit(): void;
  /** 방장 "기다리지 않고 진행하기": 앱 모양 확인 시트를 연다(11/3: 시스템 창 대신) */
  proceed(): void;
  /** 확인 시트에 보일 안내. 열려 있을 때만 있고, 아직 안 답한 사람이 바뀌면 같이 바뀐다 */
  proceedAsk: string | null;
  confirmProceed(): void;
  cancelProceed(): void;
  proceeding: boolean;
  error: string | null;
};

/**
 * 사람 확인(5단계) 보내기. 고른 것을 서버에 보내고, 방장이 먼저 마감하는 것과 시연 모드 자동 답을 맡는다.
 * 새 회의나 새 안건 목록이 오면 고른 것을 비운다.
 */
export function useReview(state: MeetingState, session: Session | null, isHost: boolean): ReviewFlow {
  const items = useMemo(() => state.review?.items ?? [], [state.review?.items]);
  const meetingId = state.meetingId;
  const key = `${meetingId ?? ''}|${items.map((i) => i.placeId).join(',')}`;
  const [picks, setPicks] = useState<ReviewPicks>({});
  const [submitting, setSubmitting] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef(key);
  const autoSent = useRef(new Set<string>());
  // 방장이 "기다리지 않고 진행하기"를 보냈는가(사람 확인이 닫히면 알림을 띄우고 지운다)
  const proceeded = useRef(false);

  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setPicks({});
    setError(null);
    autoSent.current = new Set();
  }, [key]);

  const sent = session !== null && hasAnswered(state, session.memberId);

  const pick = useCallback((placeId: string, keep: boolean) => {
    setPicks((prev) => ({ ...prev, [placeId]: keep }));
  }, []);

  const submit = useCallback(() => {
    const choices = toChoices(items, picks);
    if (meetingId === null || choices === null || submitting) return;
    setSubmitting(true);
    setError(null);
    endpoints
      .submitReview(meetingId, choices)
      .catch((e: unknown) => setError(describeError(e, 'meeting')))
      .finally(() => setSubmitting(false));
  }, [items, meetingId, picks, submitting]);

  // 확인 시트가 열려 있는가. 안내 글은 그릴 때마다 지금 안 답한 사람으로 만든다.
  const [asking, setAsking] = useState(false);
  const proceed = useCallback(() => {
    if (meetingId === null || proceeding) return;
    setAsking(true);
  }, [meetingId, proceeding]);
  const cancelProceed = useCallback(() => setAsking(false), []);
  const confirmProceed = useCallback(() => {
    if (meetingId === null || proceeding) return;
    setAsking(false);
    setProceeding(true);
    setError(null);
    // 보내고 나서도 서버가 사람 확인을 닫는 이벤트가 올 때까지(아래 효과) 도는 표시를 둔다. 실패하면 바로 푼다.
    // 닫는 이벤트가 응답보다 먼저 올 수 있어 보내기 전에 표시해 둔다.
    proceeded.current = true;
    endpoints.closeReview(meetingId).catch((e: unknown) => {
      proceeded.current = false;
      setError(describeError(e, 'meeting'));
      setProceeding(false);
    });
  }, [meetingId, proceeding]);
  const waiting = pendingNames(state);
  const proceedAsk = asking
    ? `아직 안 답한 ${waiting.length > 0 ? `${waiting.join('·')} 님은 ` : ''}모든 안건을 ‘포함’으로 계산해요. 진행하면 더 답할 수 없어요.`
    : null;

  // 시연 모드: 방장이 아닌 구성원 몫을 간격을 두고 대신 보낸다.
  const demo = session?.demo === true && isHost;
  const reviewing = state.phase === 'reviewing' && meetingId !== null;
  // "기다리지 않고 진행하기"의 도는 표시는 사람 확인이 실제로 닫히면(다음 단계로 넘어가면) 풀고, 진행했다고 짧게 알린다.
  useEffect(() => {
    if (reviewing) return;
    setProceeding(false);
    setAsking(false);
    if (!proceeded.current) return;
    proceeded.current = false;
    showToast('안 답한 안건은 ‘포함’으로 계산했어요');
  }, [reviewing]);
  useEffect(() => {
    if (!demo || !reviewing || meetingId === null) return;
    const todo = demoAnswers(state, session?.memberId ?? '').filter(
      (a) => !state.review?.answeredBy.includes(a.memberId) && !autoSent.current.has(a.memberId),
    );
    if (todo.length === 0) return;
    const next = todo[0] as { memberId: string; choices: ReviewChoice[] };
    const timer = setTimeout(() => {
      autoSent.current.add(next.memberId);
      endpoints.submitReview(meetingId, next.choices, next.memberId).catch((e: unknown) => {
        autoSent.current.delete(next.memberId);
        setError(describeError(e, 'meeting'));
      });
    }, DEMO_ANSWER_GAP_MS);
    return () => clearTimeout(timer);
    // state.review.answeredBy가 바뀔 때마다 다음 사람 몫을 예약한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, reviewing, meetingId, state.review?.answeredBy, state.board]);

  return {
    picks,
    pick,
    canSend: canSend(items, picks) && !sent,
    sendLabel: sendLabel(items, picks),
    submitting,
    sent,
    submit,
    proceed,
    proceedAsk,
    confirmProceed,
    cancelProceed,
    proceeding,
    error,
  };
}
