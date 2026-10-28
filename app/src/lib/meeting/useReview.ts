import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { endpoints } from '../api/index.ts';
import { describeError } from '../ui/format.ts';
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
  /** 방장 "기다리지 않고 진행하기": 확인 창을 거친다 */
  proceed(): void;
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

  const proceed = useCallback(() => {
    if (meetingId === null || proceeding) return;
    const waiting = pendingNames(state);
    const who = waiting.length > 0 ? `${waiting.join('·')} 님은 ` : '';
    Alert.alert('지금 진행할까요?', `아직 안 답한 ${who}모든 안건을 ‘넣기’로 계산해요. 진행하면 더 답할 수 없어요.`, [
      { text: '더 기다리기', style: 'cancel' },
      {
        text: '진행하기',
        onPress: () => {
          setProceeding(true);
          setError(null);
          endpoints
            .closeReview(meetingId)
            .catch((e: unknown) => setError(describeError(e, 'meeting')))
            .finally(() => setProceeding(false));
        },
      },
    ]);
  }, [meetingId, proceeding, state]);

  // 시연 모드: 방장이 아닌 구성원 몫을 간격을 두고 대신 보낸다.
  const demo = session?.demo === true && isHost;
  const reviewing = state.phase === 'reviewing' && meetingId !== null;
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
    proceeding,
    error,
  };
}
