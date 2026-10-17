import type { MeetingEvent, MeetingEventType } from './types.ts';

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

export function eventDelayMs(event: MeetingEvent): number {
  return EVENT_DELAY_MS[event.type];
}

export function eventsUntilFirstAgreed(events: MeetingEvent[]): MeetingEvent[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const index = sorted.findIndex((e) => e.type === 'meeting.agreed');
  return index === -1 ? sorted : sorted.slice(0, index + 1);
}
