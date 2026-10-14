import type { MeetingEvent } from './types.ts';

export function planPlayback(
  events: MeetingEvent[],
  options: { intervalMs: number },
): { delayMs: number; event: MeetingEvent }[] {
  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .map((event, i) => ({ delayMs: i * options.intervalMs, event }));
}
