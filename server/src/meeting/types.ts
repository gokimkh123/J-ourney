/** 회의 조건 (명세서 4.4 PUT /trips/{tripId}/conditions 본문과 같은 형식) */
export interface TripConditions {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: number | null;
  transport: string | null;
  rules: { aiMinSatisfaction: number; maxRounds: number };
}

/** 목적지를 코드로 바꾼 결과 (districtCodes가 비면 시·도 전체) */
export interface ResolvedDestination {
  regionCode: string;
  regionName: string;
  districtCodes: string[];
  label: string;
}

/** 후보 보드의 반응 (명세서 board.updated): like 👍 · warn ⚠ · block ✕ */
export type ReactionKind = 'like' | 'warn' | 'block';
export interface Reaction {
  agentId: string;
  kind: ReactionKind;
  reason: string;
}
export interface BoardCandidate {
  placeId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  proposedBy: string[];
  reactions: Reaction[];
}
/**
 * 후보 보드 (명세서 board.updated의 data). agenda는 ⚠·✕가 붙은 곳·여행지 밖에서 넣은 곳으로 만든 회의 안건 (이벤트 data로 그대로 보내려고 type으로 둠)
 * placeId가 null인 안건은 장소가 아닌 메모 (여행지 밖이라 후보에 넣지 못한 꼭 지킬 것)
 */
export type Board = {
  candidates: BoardCandidate[];
  agenda: { placeId: string | null; text: string }[];
};
