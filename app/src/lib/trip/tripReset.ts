type SessionLike = {
  getSession(): { tripId: string } | null;
  subscribe(listener: () => void): () => void;
};

/**
 * 참여한 여행이 바뀌거나(다른 여행 참여) 없어지면(나가기) onChange를 부른다.
 * 화면은 여기서 이전 여행의 회의 조건·합의안처럼 여행에 묶인 상태를 비운다.
 * 처음 부를 때의 여행은 기준으로만 삼고, 해제 함수를 돌려준다.
 */
export function watchTripChange(session: SessionLike, onChange: () => void): () => void {
  let tripId = session.getSession()?.tripId ?? null;
  return session.subscribe(() => {
    const next = session.getSession()?.tripId ?? null;
    if (next === tripId) return;
    tripId = next;
    onChange();
  });
}
