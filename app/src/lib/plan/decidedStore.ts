import { createValueStore } from '../store/valueStore.ts';
import type { PlanBoardStatus } from './board.ts';

/**
 * A·B가 정해진 여행(일정 표가 고르기 다음 단계). 회의 탭은 여기 든 여행이면 탭 막대에서 빠진다(11/2 결정: 회의가 끝나면 회의 탭을 없앰).
 * 같은 여행에서 회의를 다시 할 수 없어(서버 409) 한 번 들면 빼지 않는다. 앱을 끄면 비고, 일정 표를 다시 받으면 다시 든다.
 */
export const decidedTrips = createValueStore<Record<string, true>>({});

/** 일정 표 상태가 고르기 뒤(revising·voting·confirmed)면 그 여행을 정해진 것으로 적는다. */
export function noteBoardStatus(tripId: string, status: PlanBoardStatus): void {
  if (status === 'choosing' || decidedTrips.get()[tripId] === true) return;
  decidedTrips.set({ ...decidedTrips.get(), [tripId]: true });
}
