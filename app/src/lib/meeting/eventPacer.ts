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
  /** 보기 일시정지: 받은 이벤트는 쌓아 두고 넘기지 않는다(ping·읽을 수 없는 글은 그대로 넘김). 회의는 서버에서 계속된다. */
  pause(): void;
  /** 멈춘 자리부터 평소 쉬는 시간으로 이어서 넘긴다. */
  resume(): void;
  /** "지금으로": 쌓인 것을 쉬지 않고 모두 넘기고 멈춤을 푼다. */
  flush(): void;
  /** 넘기지 않고 쌓여 있는 이벤트 수 */
  queued(): number;
};

/** 멈춰 있어도 사람이 해야 하는 단계(사람 확인·회의 끝 뒤 A·B 고르기)가 오면 그 자리까지 바로 넘기고 멈춤을 푼다. */
export function wakesPause(event: ServerEvent): boolean {
  return event.type === 'review.requested' || event.type === 'meeting.agreed';
}

/** ping과 사람이 한 일(review.*, 고르기, 확정 투표)은 늦추지 않는다. 그 밖에는 목업 재생과 같은 쉬는 시간. */
export function paceDelayMs(event: ServerEvent, state?: MeetingState): number {
  if (event.type === 'ping' || event.type.startsWith('review.')) return 0;
  if (event.type === 'choice.cast' || event.type === 'plan.chosen' || event.type.startsWith('confirm.') || event.type === 'plan.confirmed') return 0;
  return eventDelayMs(event as MeetingEvent, state);
}

type Queued = { text: string; event: ServerEvent };

export function createEventPacer(options: {
  clock: PacerClock;
  deliver(text: string): void;
  delayAfter(event: ServerEvent): number;
  catchUpMs?: number;
  /** 멈춘 채로 시작(다시 붙어도 일시정지를 이어 간다) */
  paused?: boolean;
  /** 멈춰 있을 때 이 이벤트가 오면 거기까지 바로 넘기고 멈춤을 푼다 */
  wakeOn?(event: ServerEvent): boolean;
  /** wakeOn으로 멈춤이 풀렸을 때 */
  onWake?(): void;
}): EventPacer {
  const { clock, deliver, delayAfter } = options;
  const catchUpMs = options.catchUpMs ?? 0;
  let paused = options.paused === true;

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
      while (!disposed && !paused && queue.length > 0) {
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

  function stopTimer(): void {
    if (hasTimer) clock.clearTimeout(timer);
    hasTimer = false;
    timer = null;
  }

  // 쌓인 것을 쉬지 않고 모두 넘긴다. 다음 이벤트는 바로 넘길 수 있게 쉬는 시간을 지운다.
  function flushAll(): void {
    stopTimer();
    paused = false;
    processing = true;
    try {
      while (!disposed && queue.length > 0) deliver((queue.shift() as Queued).text);
    } finally {
      processing = false;
    }
    restUntil = clock.now();
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
      if (paused) {
        queue.push({ text, event });
        if (options.wakeOn?.(event) === true) {
          flushAll();
          if (!disposed) options.onWake?.();
        }
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
      stopTimer();
    },
    pause() {
      if (disposed || paused) return;
      paused = true;
      stopTimer();
    },
    resume() {
      if (disposed || !paused) return;
      paused = false;
      // 멈춘 동안 지난 시간만큼 이미 쉬었으니 첫 이벤트는 바로 넘긴다.
      restUntil = Math.min(restUntil, clock.now());
      if (!processing && !hasTimer) drain();
    },
    flush() {
      if (disposed) return;
      flushAll();
    },
    queued: () => queue.length,
  };
}
