import type {
  AgentResearch,
  ApplyResult,
  ConfirmVoteStatus,
  MeetingEvent,
  MeetingState,
  RouteDay,
  ServerEvent,
  TimelineItem,
} from './types.ts';

function emptyBoard(): MeetingState['board'] {
  return { candidates: [], agenda: [] };
}

export function initialMeetingState(): MeetingState {
  return {
    lastSeq: 0,
    phase: 'idle',
    meetingId: null,
    kind: 'meeting',
    agents: [],
    research: {},
    board: emptyBoard(),
    round: 0,
    maxRounds: 0,
    timeline: [],
    plans: {},
    latestPlanId: null,
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
    case 'meeting.started': {
      const { agents, meetingId, kind, maxRounds } = event.data;
      const base = {
        ...state,
        phase: 'researching' as const,
        meetingId,
        kind,
        agents,
        round: 0,
        maxRounds,
        timeline: [],
        votes: {},
        agreement: null,
        failure: null,
        confirmVotes: {},
        confirmedPlanId: null,
      };
      if (kind === 'renegotiation') return base;
      const research: Record<string, AgentResearch> = {};
      for (const agent of agents) {
        research[agent.agentId] = { stage: 'planning', tool: null, focus: null, foundCount: 0 };
      }
      return { ...base, research, board: emptyBoard(), plans: {}, latestPlanId: null };
    }
    case 'research.progress': {
      const { agentId, stage, tool, focus, foundCount } = event.data;
      if (state.research[agentId] === undefined) return state;
      return {
        ...state,
        research: {
          ...state.research,
          [agentId]: { stage, tool: tool ?? null, focus: focus ?? null, foundCount },
        },
      };
    }
    case 'board.updated':
      return { ...state, board: event.data };
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
      const { planId, version, route } = event.data;
      return {
        ...state,
        plans: { ...state.plans, [planId]: { version, route } },
        latestPlanId: planId,
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
      const canConfirm =
        state.phase === 'agreed' ||
        (state.phase === 'failed' && state.failure !== null && state.failure.planId !== null);
      if (!canConfirm) return state;
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

export function latestRoute(state: MeetingState): RouteDay[] {
  if (state.latestPlanId === null) return [];
  return state.plans[state.latestPlanId]?.route ?? [];
}

export function yesCount(state: MeetingState, planId: string): number {
  return Object.values(state.votes[planId] ?? {}).filter((v) => v.vote === 'yes').length;
}

export function confirmSummary(state: MeetingState): {
  approve: number;
  revise: number;
  reject: number;
  pending: number;
} {
  const summary = { approve: 0, revise: 0, reject: 0, pending: 0 };
  for (const status of Object.values(state.confirmVotes)) summary[status] += 1;
  return summary;
}

export function researchDone(state: MeetingState): boolean {
  return (
    state.agents.length > 0 &&
    state.agents.every((agent) => state.research[agent.agentId]?.stage === 'done')
  );
}
