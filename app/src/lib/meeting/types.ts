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

export type AgendaItem = { placeId: string; text: string };

export type Board = { candidates: BoardCandidate[]; agenda: AgendaItem[] };

export type PlaceInfo = {
  name: string;
  openHours: string | null;
  popularity: number;
  crowd: number;
  links: { kakaoMap: string; naverMap: string };
};

export type RouteStop = { itemId: string; name: string; lat: number; lng: number };
export type RouteDay = { day: number; stops: RouteStop[] };

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
  { planId: string; version: number; route: RouteDay[] }
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

export type PingEvent = {
  type: 'ping';
  tripId?: string;
  seq?: number;
  at?: string;
  data?: undefined;
};

export type ServerEvent = MeetingEvent | PingEvent;

export type MeetingPhase =
  | 'idle'
  | 'researching'
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
  plans: Record<string, { version: number; route: RouteDay[] }>;
  latestPlanId: string | null;
  votes: Record<string, Record<string, { vote: AiVote; score: number }>>;
  agreement: MeetingAgreedData | null;
  failure: MeetingFailedEvent['data'] | null;
  confirmVotes: Record<string, ConfirmVoteStatus>;
  confirmedPlanId: string | null;
};

export type ApplyResult =
  | { state: MeetingState; gap: false }
  | { state: MeetingState; gap: true; afterSeq: number };
