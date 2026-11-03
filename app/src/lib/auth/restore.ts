import type { SessionResponse } from '../persona/types.ts';
import { fromSessionResponse, type Session } from '../session/session.ts';

export type RestoreDeps = {
  getMyTripIds(): Promise<string[]>;
  reissueTripToken(tripId: string): Promise<SessionResponse>;
  /** 이 폰에 이미 있는 파티의 여행 id */
  localTripIds(): string[];
  add(session: Session): Promise<void>;
};

export type RestoreResult = { restored: number; failed: number };

/**
 * 로그인 뒤 내 여행 되찾기: 계정에 묶인 여행 중 이 폰에 없는 것만 구성원 토큰을 새로 받아 내 파티 목록에 넣는다.
 * 이 폰에 이미 있는 파티는 토큰을 다시 받지 않는다(다시 받으면 이 폰의 예전 토큰과 실시간 연결이 끊긴다).
 * 목록을 못 받으면 오류를 그대로 던지고, 여행 하나가 실패하면 세어 두고 나머지를 계속한다.
 */
export async function restoreMyTrips(deps: RestoreDeps): Promise<RestoreResult> {
  const ids = await deps.getMyTripIds();
  const local = new Set(deps.localTripIds());
  let restored = 0;
  let failed = 0;
  for (const tripId of ids) {
    if (local.has(tripId)) continue;
    try {
      await deps.add(fromSessionResponse(await deps.reissueTripToken(tripId)));
      restored += 1;
    } catch {
      failed += 1;
    }
  }
  return { restored, failed };
}
