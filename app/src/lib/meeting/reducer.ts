import type {
  ApplyResult,
  ConfirmVoteStatus,
  MeetingEvent,
  MeetingState,
  ServerEvent,
  TimelineItem,
} from './types.ts';

function initialResearch(): MeetingState['research'] {
  return {
    stage: null,
    counts: { queries: 0, places: 0, reviews: 0, tourism: 0 },
    highlights: [],
  };
}

export function initialMeetingState(): MeetingState {
  return {
    lastSeq: 0,
    phase: 'idle',
    agents: [],
    research: initialResearch(),
    round: 0,
    maxRounds: 0,
    timeline: [],
    votes: {},
    agreement: null,
    failure: null,
    confirmVotes: {},
    confirmedPlanId: null,
  };
}

function lastMessageIndex(timeline: TimelineItem[], agentId: string): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item?.kind === 'message' && item.agentId === agentId) return i;
  }
  return -1;
}

function reduce(state: MeetingState, event: MeetingEvent): MeetingState {
  switch (event.type) {
    case 'meeting.started':
      return {
        ...state,
        phase: 'researching',
        agents: event.data.agents,
        research: event.data.kind === 'renegotiation' ? state.research : initialResearch(),
        round: 0,
        maxRounds: event.data.maxRounds,
        timeline: [],
        votes: {},
        agreement: null,
        failure: null,
        confirmVotes: {},
        confirmedPlanId: null,
      };
    case 'research.progress': {
      const { stage, counts, highlights } = event.data;
      return { ...state, research: { stage, counts, highlights } };
    }
    case 'round.started': {
      const { round, maxRounds } = event.data;
      return {
        ...state,
        phase: 'meeting',
        round,
        maxRounds,
        timeline: [...state.timeline, { kind: 'round', seq: event.seq, at: event.at, round, maxRounds }],
      };
    }
    case 'agent.message': {
      const { agentId, round, text } = event.data;
      return {
        ...state,
        timeline: [
          ...state.timeline,
          { kind: 'message', seq: event.seq, at: event.at, agentId, round, text, places: [] },
        ],
      };
    }
    case 'place.checked': {
      const { agentId, place } = event.data;
      const index = lastMessageIndex(state.timeline, agentId);
      if (index === -1) return state;
      return {
        ...state,
        timeline: state.timeline.map((item, i) =>
          i === index && item.kind === 'message' ? { ...item, places: [...item.places, place] } : item,
        ),
      };
    }
    case 'plan.proposed': {
      const { planId, version } = event.data;
      return {
        ...state,
        timeline: [...state.timeline, { kind: 'proposal', seq: event.seq, at: event.at, planId, version }],
      };
    }
    case 'vote.cast': {
      const { planId, agentId, vote, score } = event.data;
      return {
        ...state,
        votes: { ...state.votes, [planId]: { ...state.votes[planId], [agentId]: { vote, score } } },
      };
    }
    case 'meeting.agreed':
      return { ...state, phase: 'agreed', agreement: event.data };
    case 'meeting.failed':
      return { ...state, phase: 'failed', failure: event.data };
    case 'confirm.requested': {
      if (state.phase !== 'agreed') return state;
      const confirmVotes: Record<string, ConfirmVoteStatus> = {};
      for (const agent of state.agents) confirmVotes[agent.memberId] = 'pending';
      return { ...state, phase: 'confirming', confirmVotes };
    }
    case 'confirm.cast':
      if (state.phase !== 'confirming') return state;
      return {
        ...state,
        confirmVotes: { ...state.confirmVotes, [event.data.memberId]: event.data.decision },
      };
    case 'plan.confirmed':
      return { ...state, phase: 'confirmed', confirmedPlanId: event.data.planId };
  }
}

export function applyEvent(state: MeetingState, event: ServerEvent): ApplyResult {
  if (event.type === 'ping') return { state, gap: false };
  if (state.phase === 'confirmed') return { state, gap: false };
  if (event.seq <= state.lastSeq) return { state, gap: false };
  if (event.seq > state.lastSeq + 1) return { state, gap: true, afterSeq: state.lastSeq };
  return { state: reduce({ ...state, lastSeq: event.seq }, event), gap: false };
}
