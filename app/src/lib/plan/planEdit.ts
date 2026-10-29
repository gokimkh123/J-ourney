/**
 * 일정 고치기 한 건 (POST /trips/{tripId}/plan/edits, 명세 v2.3). 사람이 화면에서 고른 값만 보낸다(글은 받지 않음).
 * remove 빼기(끼니 식당이면 그 자리에 다른 식당) · add 관광지 넣기 · move 다른 날로 · reorder 그날 관광지 순서 · meal 끼니 식당 바꾸기(placeId null이면 서버가 다른 식당)
 * day는 0부터 센다. 한 번에 10개까지.
 */
export type PlanEdit =
  | { type: 'remove'; itemId: string }
  | { type: 'add'; placeId: string; day: number }
  | { type: 'move'; itemId: string; day: number }
  | { type: 'reorder'; day: number; itemIds: string[] }
  | { type: 'meal'; itemId: string; placeId: string | null };

export type PlanVoteDecision = 'approve' | 'reject';
