import { endpoints } from '../api/index.ts';
import { partyActions } from './index.ts';
import type { DeletePartyDeps } from './leaveParty.ts';
import { forgetPartyInfo } from './partyInfo.ts';

/** 파티 나가기·없어진 파티 정리(leaveParty.ts)에 넘길 실제 동작. api↔session 순환을 피하려고 따로 둔다. */
export const leaveDeps: DeletePartyDeps = {
  leaveTrip: (tripId) => endpoints.leaveTrip(tripId),
  deleteTrip: (tripId) => endpoints.deleteTrip(tripId),
  forgetInfo: forgetPartyInfo,
  leaveLocal: (tripId) => partyActions.leave(tripId),
};
