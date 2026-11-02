import { useCallback, useEffect, useState } from 'react';

import { describeError } from '../ui/format.ts';
import type { EditOptions } from './board.ts';
import { failedNotes } from './editView.ts';
import type { PlanEdit } from './planEdit.ts';
import { usePlanBoard } from './usePlanBoard.ts';
import type { PlanBoardFlow } from './usePlanBoard.ts';

export type PlanEditFlow = {
  flow: PlanBoardFlow;
  /** 고친 것을 한 번에 보낸다(서버가 길을 한 번 다시 찾는다). 보냈으면 true. 반영 못 한 건은 failures에 남는다 */
  apply(edits: PlanEdit[], baseVersion?: number): Promise<boolean>;
  /** 바로 앞 고치기에서 반영 못 한 건의 서버 문장 */
  failures: string[];
  clearFailures(): void;
  /** 넣을 관광지·바꿀 식당 보기. 고친 안의 version이 바뀌면 다시 불러온다 */
  options: EditOptions | null;
  optionsError: string | null;
  loadOptions(): void;
};

/**
 * 일정 탭에서 고른 안을 고친다(11/1 결정: 고친 것을 모아 "수정 확정"에 한 번에 보냄 + 기록). 서버가 준 일정 표로 바뀐다.
 * 일정 탭은 회의 이벤트를 받지 않으므로 다른 사람이 고친 것은 일정 표 폴링으로 따라온다.
 */
export function usePlanEdit(enabled: boolean, tripId: string | null): PlanEditFlow {
  const flow = usePlanBoard(enabled, tripId, 0);
  const [failures, setFailures] = useState<string[]>([]);
  const [options, setOptions] = useState<{ version: number; value: EditOptions } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const version = flow.board?.plan?.version ?? null;

  const apply = useCallback(
    async (edits: PlanEdit[], baseVersion?: number) => {
      setFailures([]);
      flow.clearNotice();
      const { result, results } = await flow.edit(edits, baseVersion);
      setFailures(failedNotes(results));
      return result.ok;
    },
    [flow],
  );

  const loadOptions = useCallback(() => {
    if (version === null || options?.version === version) return;
    setOptionsError(null);
    flow
      .loadOptions()
      .then((value) => setOptions({ version, value }))
      .catch((e: unknown) => setOptionsError(describeError(e)));
  }, [flow, version, options?.version]);

  // 안이 바뀌면(내가 또는 다른 사람이 고침) 바로 앞 실패 안내는 지운다.
  useEffect(() => setFailures([]), [version]);

  return {
    flow,
    apply,
    failures,
    clearFailures: () => setFailures([]),
    options: options !== null && options.version === version ? options.value : null,
    optionsError,
    loadOptions,
  };
}
