import { durationLabel } from '../ui/format.ts';
import { latestRoute } from './reducer.ts';
import type { AgentInfo, MeetingState, TimelineItem } from './types.ts';

type MessageItem = Extract<TimelineItem, { kind: 'message' }>;
type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export type MemberRef = { memberId: string; name: string; color: string };

const FALLBACK_COLOR = '#8B95A1';

function messagesOf(state: MeetingState): MessageItem[] {
  return state.timeline.filter((item): item is MessageItem => item.kind === 'message');
}

function agentOf(state: MeetingState, agentId: string): AgentInfo | undefined {
  return state.agents.find((agent) => agent.agentId === agentId);
}

function lastMessage(state: MeetingState): MessageItem | undefined {
  return messagesOf(state)
    .filter((m) => agentOf(state, m.agentId) !== undefined)
    .at(-1);
}

function routeNames(state: MeetingState): string[] {
  return [...latestRoute(state)]
    .sort((a, b) => a.day - b.day)
    .flatMap((day) => day.stops.map((stop) => stop.name));
}

function pinColor(state: MeetingState, proposedBy: string[]): string {
  const first = proposedBy[0];
  if (first === undefined) return FALLBACK_COLOR;
  return agentOf(state, first)?.color ?? FALLBACK_COLOR;
}

export function membersOf(state: MeetingState): MemberRef[] {
  return state.agents.map((agent) => ({
    memberId: agent.memberId,
    name: agent.nickname,
    color: agent.color,
  }));
}

export function phaseLabel(state: MeetingState): string {
  switch (state.phase) {
    case 'idle':
      return '대기 중';
    case 'researching':
      return 'AI들이 장소를 조사하고 있어요';
    case 'meeting':
      return `${state.round}/${state.maxRounds}라운드 회의 중`;
    case 'agreed':
      return '합의안이 나왔어요';
    case 'failed':
      return '합의하지 못했어요';
    case 'confirming':
      return '확정 투표를 기다리고 있어요';
    case 'confirmed':
      return '일정이 확정됐어요';
  }
}

export function agentRows(state: MeetingState): {
  name: string;
  color: string;
  chips: AgentInfo['chips'];
  text: string;
  statusLabel: string;
  statusTone: StatusTone;
  active: boolean;
}[] {
  const last = lastMessage(state);
  return state.agents.map((agent) => {
    const base = { name: agent.nickname, color: agent.color, chips: agent.chips };
    if (state.phase === 'researching') {
      const r = state.research[agent.agentId] ?? { stage: 'planning', focus: null, foundCount: 0 };
      let text: string;
      if (r.stage === 'planning') text = '조사할 곳을 고르는 중';
      else if (r.stage === 'searching') {
        text = r.focus ? `${r.focus.label} 쪽을 살펴보는 중` : '장소를 찾는 중';
      } else if (r.stage === 'picking') text = '후보를 고르는 중';
      else text = `후보 ${r.foundCount}곳 골랐어요`;
      const done = r.stage === 'done';
      return {
        ...base,
        text,
        statusLabel: done ? '완료' : '조사 중',
        statusTone: done ? 'success' : 'accent',
        active: false,
      };
    }
    const own = messagesOf(state).filter((m) => m.agentId === agent.agentId).at(-1);
    const vote =
      state.latestPlanId === null
        ? undefined
        : state.votes[state.latestPlanId]?.[agent.agentId]?.vote;
    let statusLabel = '대기';
    let statusTone: StatusTone = 'neutral';
    if (vote === 'yes') {
      statusLabel = '찬성';
      statusTone = 'success';
    } else if (vote === 'no') {
      statusLabel = '반대';
      statusTone = 'danger';
    } else if (state.phase === 'meeting') {
      statusLabel = '회의 중';
      statusTone = 'accent';
    }
    return {
      ...base,
      text: own?.text ?? '회의에 참여하고 있어요',
      statusLabel,
      statusTone,
      active: state.phase === 'meeting' && last?.agentId === agent.agentId,
    };
  });
}

function lastVisitedCandidate(
  state: MeetingState,
  messages: MessageItem[],
  agentId: string,
): { lat: number; lng: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === undefined || message.agentId !== agentId) continue;
    for (let j = message.places.length - 1; j >= 0; j -= 1) {
      const name = message.places[j]?.name;
      const found = state.board.candidates.find((c) => c.name === name);
      if (found !== undefined) return { lat: found.lat, lng: found.lng };
    }
  }
  return undefined;
}

export function mapAgents(state: MeetingState): {
  id: string;
  name: string;
  color: string;
  chips: AgentInfo['chips'];
  lat: number;
  lng: number;
  searching: boolean;
}[] {
  const result = [];
  const messages = messagesOf(state);
  for (const agent of state.agents) {
    const research = state.research[agent.agentId];
    let lat: number;
    let lng: number;
    // 회의 중에는 AI가 마지막으로 확인한 장소 후보에 계속 머문다. 다른 AI가 말해도 제자리로 돌아가지 않는다.
    const visited = state.phase === 'meeting' ? lastVisitedCandidate(state, messages, agent.agentId) : undefined;
    if (visited !== undefined && !research?.focus) {
      lat = visited.lat;
      lng = visited.lng;
    } else if (research?.focus) {
      lat = research.focus.lat;
      lng = research.focus.lng;
    } else {
      const own = state.board.candidates.filter((c) => c.proposedBy.includes(agent.agentId));
      if (own.length === 0) continue;
      lat = own.reduce((sum, c) => sum + c.lat, 0) / own.length;
      lng = own.reduce((sum, c) => sum + c.lng, 0) / own.length;
    }
    result.push({
      id: agent.agentId,
      name: agent.nickname,
      color: agent.color,
      chips: agent.chips,
      lat,
      lng,
      searching: state.phase === 'researching' && research?.stage !== 'done',
    });
  }
  return result;
}

export function mapPins(state: MeetingState): {
  id: string;
  name: string;
  lat: number;
  lng: number;
  color: string;
  label?: string;
}[] {
  const names = routeNames(state);
  return state.board.candidates.map((c) => {
    const pin = {
      id: c.placeId,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      color: pinColor(state, c.proposedBy),
    };
    const index = names.indexOf(c.name);
    return index === -1 ? pin : { ...pin, label: String(index + 1) };
  });
}

export function candidateRows(state: MeetingState): {
  placeId: string;
  name: string;
  proposerColor: string;
  order?: number;
  reactions: { name: string; color: string; kind: 'like' | 'warn' | 'block'; reason: string }[];
}[] {
  const pins = mapPins(state);
  return state.board.candidates.map((c) => {
    const reactions = [];
    for (const r of c.reactions) {
      const agent = agentOf(state, r.agentId);
      if (agent === undefined) continue;
      reactions.push({ name: agent.nickname, color: agent.color, kind: r.kind, reason: r.reason });
    }
    const row = {
      placeId: c.placeId,
      name: c.name,
      proposerColor: pinColor(state, c.proposedBy),
      reactions,
    };
    const label = pins.find((p) => p.id === c.placeId)?.label;
    return label === undefined ? row : { ...row, order: Number(label) };
  });
}

export function speechFeed(state: MeetingState): {
  seq: number;
  agentId: string;
  name: string;
  color: string;
  chips: AgentInfo['chips'];
  text: string;
  round: number;
  meta: string;
}[] {
  const rows = [];
  for (const m of [...messagesOf(state)].sort((a, b) => a.seq - b.seq)) {
    const agent = agentOf(state, m.agentId);
    if (agent === undefined) continue;
    rows.push({
      seq: m.seq,
      agentId: m.agentId,
      name: agent.nickname,
      color: agent.color,
      chips: agent.chips,
      text: m.text,
      round: m.round,
      meta: `${m.round}라운드`,
    });
  }
  return rows;
}

export function currentBubble(state: MeetingState): { agentId: string; text: string } | null {
  if (state.phase !== 'meeting') return null;
  const last = lastMessage(state);
  return last === undefined ? null : { agentId: last.agentId, text: last.text };
}

export function mapPoints(state: MeetingState): { lat: number; lng: number }[] {
  return [...mapAgents(state), ...mapPins(state)].map(({ lat, lng }) => ({ lat, lng }));
}

export function agreementView(state: MeetingState): {
  stats: { value: string; label: string }[];
  satisfaction: { name: string; color: string; score: number }[];
  concessions: { name: string; color: string; gave: string; got: string }[];
} | null {
  const a = state.agreement;
  if (a === null) return null;
  const members = new Map(membersOf(state).map((m) => [m.memberId, m]));
  const satisfaction = [];
  for (const s of a.satisfaction) {
    const m = members.get(s.memberId);
    if (m === undefined) continue;
    satisfaction.push({ name: m.name, color: m.color, score: s.score });
  }
  const concessions = [];
  for (const c of a.concessions) {
    const m = members.get(c.memberId);
    if (m === undefined) continue;
    concessions.push({ name: m.name, color: m.color, gave: c.gave, got: c.got });
  }
  return {
    stats: [
      { value: durationLabel(a.durationSec), label: '걸린 시간' },
      { value: `${a.proposalCount}번`, label: '제안' },
      { value: `${a.editCount}번`, label: '수정' },
    ],
    satisfaction,
    concessions,
  };
}
