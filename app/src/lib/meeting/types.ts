export const MEETING_EVENT_TYPES = [
  'meeting.started',
  'research.progress',
  'board.updated',
  'round.started',
  'agent.message',
  'place.checked',
  'plan.proposed',
  'vote.cast',
  'meeting.agreed',
  'meeting.failed',
  'confirm.requested',
  'confirm.cast',
  'plan.confirmed',
] as const;

export type MeetingEventType = (typeof MEETING_EVENT_TYPES)[number];

/** 사람 확인(5단계) 이벤트. 옛 가짜 회의(부산 예시)에는 없고 실서버만 보낸다. */
export const REVIEW_EVENT_TYPES = ['review.requested', 'review.cast', 'review.closed'] as const;

export type ReviewEventType = (typeof REVIEW_EVENT_TYPES)[number];

export type MeetingKind = 'meeting' | 'renegotiation';
export type ResearchStage = 'planning' | 'searching' | 'picking' | 'done';
export type ResearchTool = 'tourSearch' | 'tourRank' | 'crowd' | 'price' | 'distance';
export type AiVote = 'yes' | 'no';
export type ConfirmDecision = 'approve' | 'revise' | 'reject';

export type AgentInfo = {
  agentId: string;
  memberId: string;
  nickname: string;
  title: string;
  chips: { label: string; emoji: string }[];
  color: string;
};

export type Focus = { lat: number; lng: number; label: string };

export type AgentResearch = {
  stage: ResearchStage;
  tool: ResearchTool | null;
  focus: Focus | null;
  foundCount: number;
};

export type BoardReaction = {
  agentId: string;
  kind: 'like' | 'warn' | 'block';
  reason: string;
};

export type BoardCandidate = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  proposedBy: string[];
  reactions: BoardReaction[];
};

/** placeId가 null인 안건은 장소가 아닌 메모(후보에 넣지 못한 꼭 지킬 것과 까닭) */
export type AgendaItem = { placeId: string | null; text: string };

export type Board = { candidates: BoardCandidate[]; agenda: AgendaItem[] };

export type PlaceInfo = {
  name: string;
  openHours: string | null;
  popularity: number;
  crowd: number;
  links: { kakaoMap: string; naverMap: string };
};

/** 구간 이동(서버 moveFromPrev). 길찾기를 못 했으면 minutes가 null이고 직선거리만 있다. */
export type MoveLeg = {
  mode: 'walk' | 'bus' | 'subway' | 'train' | 'taxi' | 'car' | null;
  minutes: number | null;
  distanceM: number;
  fareWon: number | null;
  source: 'kakao_route' | 'estimate';
  routeUrl: string | null;
  note?: string;
};

/** itemId·name·lat·lng 말고는 서버(v1.8)만 채우는 칸이라 선택으로 둔다. */
export type RouteStop = {
  itemId: string;
  name: string;
  lat: number;
  lng: number;
  placeId?: string;
  kind?: 'sight' | 'food' | 'lodging';
  category?: string | null;
  meal?: 'lunch' | 'dinner' | null;
  night?: boolean;
  mustFor?: string[];
  likedBy?: string[];
  moveFromPrev?: MoveLeg | null;
};
export type RouteDay = {
  day: number;
  stops: RouteStop[];
  date?: string;
  summary?: { moveMinutes: number; unknownLegs: number; spanMinutes: number; heavy: boolean };
};

export type MeetingAgreedData = {
  planId: string;
  round: number;
  durationSec: number;
  proposalCount: number;
  editCount: number;
  satisfaction: { memberId: string; score: number }[];
  concessions: { memberId: string; gave: string; got: string }[];
};

type EventBase<T extends string, D> = {
  type: T;
  tripId: string;
  seq: number;
  at: string;
  data: D;
};

export type MeetingStartedEvent = EventBase<
  'meeting.started',
  {
    meetingId: string;
    kind: MeetingKind;
    maxRounds: number;
    agents: AgentInfo[];
  }
>;

export type ResearchProgressEvent = EventBase<
  'research.progress',
  {
    agentId: string;
    stage: ResearchStage;
    tool?: ResearchTool | null;
    focus?: Focus | null;
    foundCount: number;
  }
>;

export type BoardUpdatedEvent = EventBase<'board.updated', Board>;

export type RoundStartedEvent = EventBase<
  'round.started',
  { round: number; maxRounds: number }
>;

export type AgentMessageEvent = EventBase<
  'agent.message',
  { agentId: string; round: number; text: string }
>;

export type PlaceCheckedEvent = EventBase<
  'place.checked',
  { agentId: string; place: PlaceInfo }
>;

export type PlanProposedEvent = EventBase<
  'plan.proposed',
  {
    planId: string;
    version: number;
    route: RouteDay[];
    /** 서버 v1.8: 두 안 A·B와 숙소·이동 수단·안내 */
    label?: 'A' | 'B';
    moveMode?: 'transit' | 'car';
    lodging?: { placeId: string; name: string } | null;
    notes?: string[];
  }
>;

export type VoteCastEvent = EventBase<
  'vote.cast',
  { planId: string; agentId: string; vote: AiVote; score: number }
>;

export type MeetingAgreedEvent = EventBase<'meeting.agreed', MeetingAgreedData>;

export type MeetingFailedEvent = EventBase<
  'meeting.failed',
  { reason: 'max_rounds' | 'error'; planId: string | null }
>;

export type ConfirmRequestedEvent = EventBase<
  'confirm.requested',
  { planId: string; version: number }
>;

export type ConfirmCastEvent = EventBase<
  'confirm.cast',
  { planId: string; memberId: string; decision: ConfirmDecision }
>;

export type PlanConfirmedEvent = EventBase<'plan.confirmed', { planId: string }>;

export type MeetingEvent =
  | MeetingStartedEvent
  | ResearchProgressEvent
  | BoardUpdatedEvent
  | RoundStartedEvent
  | AgentMessageEvent
  | PlaceCheckedEvent
  | PlanProposedEvent
  | VoteCastEvent
  | MeetingAgreedEvent
  | MeetingFailedEvent
  | ConfirmRequestedEvent
  | ConfirmCastEvent
  | PlanConfirmedEvent;

export type ReviewItemData = { placeId: string; name: string; text: string; consequence: string | null };
export type ReviewVoteData = { placeId: string; keep: number; drop: number; kept: boolean; tie: boolean };
export type ReviewDecisionData = {
  kept: string[];
  dropped: string[];
  votes: ReviewVoteData[];
  responded: string[];
  defaulted: string[];
  closedBy: 'all' | 'host';
};

export type ReviewRequestedEvent = EventBase<
  'review.requested',
  { meetingId: string; items: ReviewItemData[]; memos: string[]; total: number }
>;
export type ReviewCastEvent = EventBase<
  'review.cast',
  { meetingId: string; memberId: string; answered: number; total: number }
>;
export type ReviewClosedEvent = EventBase<'review.closed', { meetingId: string } & ReviewDecisionData>;

export type ReviewEvent = ReviewRequestedEvent | ReviewCastEvent | ReviewClosedEvent;

export type PingEvent = {
  type: 'ping';
  tripId?: string;
  seq?: number;
  at?: string;
  data?: undefined;
};

export type ServerEvent = MeetingEvent | ReviewEvent | PingEvent;

export type MeetingPhase =
  | 'idle'
  | 'researching'
  | 'reviewing'
  | 'proposed'
  | 'meeting'
  | 'agreed'
  | 'failed'
  | 'confirming'
  | 'confirmed';

export type TimelineItem =
  | { kind: 'round'; seq: number; at: string; round: number; maxRounds: number }
  | {
      kind: 'message';
      seq: number;
      at: string;
      agentId: string;
      round: number;
      text: string;
      places: PlaceInfo[];
    }
  | { kind: 'proposal'; seq: number; at: string; planId: string; version: number };

export type ConfirmVoteStatus = ConfirmDecision | 'pending';

export type MeetingState = {
  lastSeq: number;
  phase: MeetingPhase;
  meetingId: string | null;
  kind: MeetingKind;
  agents: AgentInfo[];
  research: Record<string, AgentResearch>;
  board: Board;
  round: number;
  maxRounds: number;
  timeline: TimelineItem[];
  plans: Record<
    string,
    {
      version: number;
      route: RouteDay[];
      label?: 'A' | 'B';
      moveMode?: 'transit' | 'car';
      lodging?: { placeId: string; name: string } | null;
      notes?: string[];
    }
  >;
  latestPlanId: string | null;
  votes: Record<string, Record<string, { vote: AiVote; score: number }>>;
  agreement: MeetingAgreedData | null;
  failure: MeetingFailedEvent['data'] | null;
  confirmVotes: Record<string, ConfirmVoteStatus>;
  confirmedPlanId: string | null;
  /** 사람 확인(5단계) 진행. 요청이 오기 전에는 null */
  review: ReviewProgress | null;
};

export type ReviewProgress = {
  items: ReviewItemData[];
  memos: string[];
  total: number;
  /** 지금까지 응답한 사람 수 */
  answered: number;
  /** 응답한 구성원 memberId (같은 사람이 다시 내도 한 번만) */
  answeredBy: string[];
  decision: ReviewDecisionData | null;
};

export type ApplyResult =
  | { state: MeetingState; gap: false }
  | { state: MeetingState; gap: true; afterSeq: number };
