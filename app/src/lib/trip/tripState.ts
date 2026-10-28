type SessionLike = {
  getSession(): { tripId: string } | null;
  subscribe(listener: () => void): () => void;
};

type Slot = { get(): unknown; set(value: never): void };

/**
 * 여행(파티)에 묶인 임시 값(회의 조건·합의안처럼 값 하나씩 든 저장소)을 여행별로 따로 보관한다.
 * 들어가 있는 파티가 바뀌면 떠나는 파티의 값을 맡아 두고, 새 파티의 값(처음이면 null)을 채운다.
 * 초기 화면(파티 없음)에서는 모두 null이다. 앱을 끄면 사라진다. 해제 함수를 돌려준다.
 */
export function keepPerTrip(session: SessionLike, slots: readonly Slot[]): () => void {
  const kept = new Map<string, unknown[]>();
  let tripId = session.getSession()?.tripId ?? null;
  return session.subscribe(() => {
    const next = session.getSession()?.tripId ?? null;
    if (next === tripId) return;
    if (tripId !== null) kept.set(tripId, slots.map((s) => s.get()));
    tripId = next;
    const restored = next === null ? undefined : kept.get(next);
    slots.forEach((slot, i) => slot.set((restored?.[i] ?? null) as never));
  });
}
