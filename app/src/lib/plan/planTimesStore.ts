import { useSyncExternalStore } from 'react';

import { asyncStorageAdapter } from '../storage/asyncStorage.ts';
import { createPlanTimesStore } from './planTimes.ts';
import type { TripTimes } from './planTimes.ts';

/** 이 폰에 저장된, 사람이 바꾼 일정 시각 */
export const planTimes = createPlanTimesStore(asyncStorageAdapter);

const NONE: TripTimes = {};

/** 여행 하나의 바꾼 시각. 바뀌면 화면이 다시 그려진다. */
export function useTripTimes(tripId: string | null): TripTimes {
  const all = useSyncExternalStore(planTimes.subscribe, planTimes.get, planTimes.get);
  return tripId === null ? NONE : (all[tripId] ?? NONE);
}
