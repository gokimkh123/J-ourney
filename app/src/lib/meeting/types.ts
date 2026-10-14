export const MEETING_EVENT_TYPES = [
  'meeting.started',
  'research.progress',
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
export type ResearchStage = 'queries' | 'search' | 'summarize' | 'done';
export type AiVote = 'yes' | 'no';
export type ConfirmDecision = 'approve' | 'revise' | 'reject';

export type AgentInfo = {
  agentId: string;
  memberId: string;
  nickname: string;
  mbti: string;
  title: string;
  color: string;
};

export type ResearchCounts = {
  queries: number;
  places: number;
  reviews: number;
  tourism: number;
};

export type ResearchHighlight = { name: string; summary: string };

export type PlaceInfo = {
  name: string;
  openHours: string | null;
  review: { count: number; summary: string } | null;
  placeUrl: string;
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
    stage: ResearchStage;
    counts: ResearchCounts;
    highlights: ResearchHighlight[];
  }
>;

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
  { planId: string; version: number }
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
  agents: AgentInfo[];
  research: {
    stage: ResearchStage | null;
    counts: ResearchCounts;
    highlights: ResearchHighlight[];
  };
  round: number;
  maxRounds: number;
  timeline: TimelineItem[];
  votes: Record<string, Record<string, { vote: AiVote; score: number }>>;
  agreement: MeetingAgreedData | null;
  failure: MeetingFailedEvent['data'] | null;
  confirmVotes: Record<string, ConfirmVoteStatus>;
  confirmedPlanId: string | null;
};

export type ApplyResult =
  | { state: MeetingState; gap: false }
  | { state: MeetingState; gap: true; afterSeq: number };
