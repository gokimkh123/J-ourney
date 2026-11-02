export type LeavePartyDeps = {
  /** 서버에서 나가기(v2.4 DELETE /trips/{id}/members/me) */
  leaveTrip(tripId: string): Promise<void>;
  /** 받아 둔 파티 정보 지우기 */
  forgetInfo(tripId: string): void;
  /** 이 폰의 파티 목록에서 빼기(들어가 있던 파티면 세션도 지움) */
  leaveLocal(tripId: string): Promise<void>;
};

/**
 * 파티 나가기. 방장이 아니면 서버에서도 나간다(방장은 서버가 403이라 부르지 않음).
 * 서버가 막아도(회의 시작 뒤 409, 연결 실패) 이 폰에서는 뺀다. 서버엔 구성원이 남을 수 있다.
 */
export async function leaveParty(deps: LeavePartyDeps, tripId: string, isHost: boolean): Promise<void> {
  if (!isHost) await deps.leaveTrip(tripId).catch(() => undefined);
  deps.forgetInfo(tripId);
  await deps.leaveLocal(tripId);
}

/** 방장이 파티를 없앴을 때(초대 조회 404, 실시간 연결 4004): 서버에 묻지 않고 이 폰에서만 뺀다. */
export async function dropDeletedParty(deps: LeavePartyDeps, tripId: string): Promise<void> {
  deps.forgetInfo(tripId);
  await deps.leaveLocal(tripId);
}
