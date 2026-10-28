import type { MeetingEvent, MeetingEventType, MeetingState } from './types.ts';

export function planPlayback(
  events: MeetingEvent[],
  options: { intervalMs: number },
): { delayMs: number; event: MeetingEvent }[] {
  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .map((event, i) => ({ delayMs: i * options.intervalMs, event }));
}

const EVENT_DELAY_MS: Record<MeetingEventType, number> = {
  'meeting.started': 800,
  'research.progress': 700,
  'board.updated': 1000,
  'round.started': 800,
  'agent.message': 1600,
  'place.checked': 500,
  'plan.proposed': 1200,
  'vote.cast': 600,
  'meeting.agreed': 1000,
  'meeting.failed': 1000,
  'confirm.requested': 800,
  'confirm.cast': 600,
  'plan.confirmed': 800,
};

// 조사 중에 후보가 하나씩 올라올 때는 핀이 연달아 꽂히도록 짧게 쉰다.
const RESEARCH_BOARD_DELAY_MS = 900;

/** event를 적용한 직후 상태(state)를 주면, 조사 중 후보 보드는 더 짧게 쉰다. */
export function eventDelayMs(event: MeetingEvent, state?: MeetingState): number {
  if (event.type === 'board.updated' && state?.phase === 'researching') return RESEARCH_BOARD_DELAY_MS;
  return EVENT_DELAY_MS[event.type];
}

export function eventsUntilFirstAgreed(events: MeetingEvent[]): MeetingEvent[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const index = sorted.findIndex((e) => e.type === 'meeting.agreed');
  return index === -1 ? sorted : sorted.slice(0, index + 1);
}
