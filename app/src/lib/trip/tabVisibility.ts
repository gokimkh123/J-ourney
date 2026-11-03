import type { TripStatus } from '../persona/types.ts';

export type TripTabsInput = {
  /** 서버 여행 상태(받기 전이면 undefined). 가짜 서버는 늘 preparing이라 아래 이 폰의 값으로 정한다. */
  tripStatus?: TripStatus;
  /** 이 폰에 회의 조건이 있다(회의를 시작했다) */
  hasConditions: boolean;
  /** 이 폰에서 이 여행 회의를 시작했다 */
  startedHere: boolean;
  /** 이 폰에 합의안이 있다(회의가 끝났다) */
  hasResult: boolean;
  /** A·B가 정해졌다 */
  decided: boolean;
};

const STARTED: readonly (TripStatus | undefined)[] = ['meeting', 'voting', 'confirmed'];
const FINISHED: readonly (TripStatus | undefined)[] = ['voting', 'confirmed'];

/**
 * 파티 안 탭 중 회의·일정 탭을 보일지(11/3 결정).
 * 회의 탭: 회의가 시작된 뒤부터 A·B가 정해지기 전까지. 일정 탭: 회의가 끝난 뒤부터.
 */
export function tripTabs({ tripStatus, hasConditions, startedHere, hasResult, decided }: TripTabsInput): { meeting: boolean; plan: boolean } {
  const started = hasConditions || startedHere || STARTED.includes(tripStatus);
  const finished = hasResult || decided || FINISHED.includes(tripStatus);
  return { meeting: started && !decided, plan: finished };
}
