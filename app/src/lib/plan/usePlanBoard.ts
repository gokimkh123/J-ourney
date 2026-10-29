import { useCallback, useEffect, useReducer, useRef } from 'react';

import { endpoints } from '../api/index.ts';
import { parseEditOptions, parseEditResults } from './board.ts';
import type { EditOptions, EditResult } from './board.ts';
import { createPlanBoardSync } from './boardSync.ts';
import type { BoardSync, BoardSyncState, RunResult } from './boardSync.ts';
import type { PlanEdit, PlanVoteDecision } from './planEdit.ts';

const clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** 회의 이벤트가 안 와도(다른 폰이 고치는 중 등) 이 간격으로 일정 표를 다시 불러온다. */
const POLL_MS = 5000;

const IDLE: BoardSyncState = { board: null, phase: 'idle', busy: false, notice: null };

export type PlanBoardFlow = BoardSyncState & {
  /** A·B 고르기. memberId는 시연 모드에서 방장이 다른 구성원 몫을 낼 때만 */
  choose(planId: string, memberId?: string): Promise<RunResult>;
  /** 방장 '지금 정하기' */
  closeChoice(): Promise<RunResult>;
  /** 고치기. 반영 못 한 건은 results의 applied가 false(note에 까닭) */
  edit(edits: PlanEdit[]): Promise<{ result: RunResult; results: EditResult[] }>;
  /** 방장 '확정 투표 시작' */
  requestConfirm(): Promise<RunResult>;
  vote(decision: PlanVoteDecision, memberId?: string): Promise<RunResult>;
  /** 고칠 때 고를 보기(넣을 관광지·바꿀 식당). 읽지 못하면 던진다 */
  loadOptions(): Promise<EditOptions>;
  clearNotice(): void;
};

/**
 * 회의가 끝난 뒤의 일정 표(명세 v2.3 GET /trips/{tripId}/plan)를 불러오고 맞춰 둔다. enabled가 켜지면 시작하고 화면이 사라지면 정리한다.
 * eventSeq는 회의 이벤트의 마지막 seq: 바뀔 때마다(고르기·고치기·투표 이벤트) 다시 불러온다.
 */
export function usePlanBoard(enabled: boolean, tripId: string | null, eventSeq: number): PlanBoardFlow {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<BoardSync | null>(null);

  useEffect(() => {
    if (!enabled || tripId === null) return;
    const sync = createPlanBoardSync({ clock, fetchBoard: () => endpoints.getPlan(tripId), pollMs: POLL_MS });
    ref.current = sync;
    const off = sync.subscribe(rerender);
    sync.start();
    rerender();
    return () => {
      off();
      sync.dispose();
      if (ref.current === sync) ref.current = null;
      rerender();
    };
  }, [enabled, tripId]);

  useEffect(() => {
    ref.current?.refresh();
  }, [eventSeq]);

  const run = useCallback((action: () => Promise<unknown>): Promise<RunResult> => {
    const sync = ref.current;
    return sync === null ? Promise.resolve({ ok: false, code: 'DISPOSED' }) : sync.run(action);
  }, []);

  const choose = useCallback(
    (planId: string, memberId?: string) => run(() => endpoints.choosePlan(tripId ?? '', planId, memberId)),
    [run, tripId],
  );
  const closeChoice = useCallback(() => run(() => endpoints.closeChoice(tripId ?? '')), [run, tripId]);
  const edit = useCallback(
    async (edits: PlanEdit[]) => {
      const result = await run(() => endpoints.editPlan(tripId ?? '', edits));
      return { result, results: result.ok ? parseEditResults(result.json) : [] };
    },
    [run, tripId],
  );
  const requestConfirm = useCallback(() => run(() => endpoints.requestConfirm(tripId ?? '')), [run, tripId]);
  const vote = useCallback(
    (decision: PlanVoteDecision, memberId?: string) => run(() => endpoints.votePlan(tripId ?? '', decision, memberId)),
    [run, tripId],
  );
  const loadOptions = useCallback(async () => parseEditOptions(await endpoints.getPlanOptions(tripId ?? '')), [tripId]);
  const clearNotice = useCallback(() => ref.current?.clearNotice(), []);

  const state = ref.current?.getState() ?? IDLE;
  return { ...state, choose, closeChoice, edit, requestConfirm, vote, loadOptions, clearNotice };
}
