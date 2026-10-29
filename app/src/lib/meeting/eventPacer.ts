import { parseEvent } from './parse.ts';
import { eventDelayMs } from './player.ts';
import type { MeetingEvent, MeetingState, ServerEvent } from './types.ts';

/** liveFeed의 FeedClock과 같은 모양(그 파일은 import하지 않는다). */
export type PacerClock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
};

export type EventPacer = {
  push(text: string): void;
  open(): void;
  dispose(): void;
};

/** ping과 사람 확인(review.*)은 늦추지 않는다. 그 밖에는 목업 재생과 같은 쉬는 시간. */
export function paceDelayMs(event: ServerEvent, state?: MeetingState): number {
  if (event.type === 'ping' || event.type.startsWith('review.')) return 0;
  return eventDelayMs(event as MeetingEvent, state);
}

type Queued = { text: string; event: ServerEvent };

export function createEventPacer(options: {
  clock: PacerClock;
  deliver(text: string): void;
  delayAfter(event: ServerEvent): number;
  catchUpMs?: number;
}): EventPacer {
  const { clock, deliver, delayAfter } = options;
  const catchUpMs = options.catchUpMs ?? 0;

  const queue: Queued[] = [];
  let timer: unknown = null;
  let hasTimer = false;
  let restUntil = Number.NEGATIVE_INFINITY;
  let catchUpEnd: number | null = null;
  let processing = false;
  let disposed = false;

  function inCatchUp(): boolean {
    return catchUpEnd !== null && clock.now() < catchUpEnd;
  }

  function drain(): void {
    processing = true;
    try {
      while (!disposed && queue.length > 0) {
        const wait = restUntil - clock.now();
        if (wait > 0) {
          timer = clock.setTimeout(onTimer, wait);
          hasTimer = true;
          break;
        }
        const item = queue.shift() as Queued;
        deliver(item.text);
        if (disposed) break;
        const delay = delayAfter(item.event);
        if (disposed) break;
        restUntil = clock.now() + (delay > 0 ? delay : 0);
      }
    } finally {
      processing = false;
    }
  }

  function onTimer(): void {
    hasTimer = false;
    timer = null;
    if (disposed) return;
    drain();
  }

  return {
    push(text) {
      if (disposed) return;
      const event = parseEvent(text);
      if (event === null || event.type === 'ping') {
        deliver(text);
        return;
      }
      if (!processing && queue.length === 0 && inCatchUp()) {
        processing = true;
        try {
          deliver(text);
        } finally {
          processing = false;
        }
        if (!disposed && queue.length > 0 && !hasTimer) drain();
        return;
      }
      queue.push({ text, event });
      if (!processing && !hasTimer) drain();
    },
    open() {
      if (disposed || catchUpEnd !== null || !(catchUpMs > 0)) return;
      catchUpEnd = clock.now() + catchUpMs;
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      if (hasTimer) clock.clearTimeout(timer);
      hasTimer = false;
      timer = null;
    },
  };
}
