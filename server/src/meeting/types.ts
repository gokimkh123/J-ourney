/** 현지 이동 수단 (명세서 v1.8 moveMode): 대중교통이면 6단계가 대중교통·택시를, 자차면 자동차 길을 붙임 */
export type MoveMode = 'transit' | 'car';

/** 회의 조건 (명세서 4.4 PUT /trips/{tripId}/conditions 본문과 같은 형식) */
export interface TripConditions {
  destination: string;
  startDate: string;
  endDate: string;
  budgetPerPerson: number | null;
  transport: string | null;
  /** v1.8에서 생김: 그 전에 저장한 조건에는 없으며 없으면 대중교통 */
  moveMode?: MoveMode;
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
 * 후보 보드 (명세서 board.updated의 data). agenda는 ⚠·✕가 붙은 곳·여행지 밖에서 넣은 곳으로 만든 회의 안건과 메모(장소 없음: AI 이름 맞추기·찾지 못한 꼭 지킬 것 등) (이벤트 data로 그대로 보내려고 type으로 둠)
 * placeId가 있는 안건은 5단계에서 사람이 남김·뺌을 고르고, null인 안건은 장소가 아닌 메모 (후보에 넣지 못한 꼭 지킬 것과 까닭)
 */
export type Board = {
  candidates: BoardCandidate[];
  agenda: { placeId: string | null; text: string }[];
};

/** 5단계 사람 확인의 안건 하나 (장소 안건). consequence: 빼면 누구의 꼭 지킬 것을 지킬 곳이 보드에서 없어지는지 */
export type ReviewItem = { placeId: string; name: string; text: string; consequence: string | null };
/** 5단계 사람 확인 요청 (명세서 review.requested의 data에 들어감): 고르는 안건과 보기만 하는 메모 */
export type ReviewRequest = { items: ReviewItem[]; memos: string[] };
/** 구성원 1명의 응답: 안건마다 남김(true) 또는 뺌(false) */
export type ReviewChoice = { placeId: string; keep: boolean };
/** 안건 하나의 집계. tie면 방장이 정한 결과 */
export type ReviewVote = { placeId: string; keep: number; drop: number; kept: boolean; tie: boolean };
/** 5단계 결과 (명세서 review.closed의 data에 들어감). defaulted: 응답하지 않아 '남김'으로 센 구성원 */
export type ReviewDecision = {
  kept: string[];
  dropped: string[];
  votes: ReviewVote[];
  responded: string[];
  defaulted: string[];
  closedBy: 'all' | 'host';
};
/** 회의 행에 저장하는 사람 확인 (요청 + 마감 결과) */
export type StoredReview = ReviewRequest & { decision?: ReviewDecision };
