import { eventDelayMs } from './player.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import type { MeetingEvent, MeetingState } from './types.ts';

export type PlaybackClock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'finished' | 'error';

export type Playback = {
  getState(): MeetingState;
  getStatus(): PlaybackStatus;
  getAppliedCount(): number;
  getTotalCount(): number;
  start(): void;
  pause(): void;
  resume(): void;
  skipToEnd(): void;
  restart(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export function createPlayback(options: {
  events: MeetingEvent[];
  clock: PlaybackClock;
  delayFor?: (event: MeetingEvent) => number;
}): Playback {
  const events = [...options.events].sort((a, b) => a.seq - b.seq);
  const clock = options.clock;
  const delayFor = options.delayFor ?? eventDelayMs;
  const listeners = new Set<() => void>();
  let state = initialMeetingState();
  let status: PlaybackStatus = 'idle';
  let index = 0;
  let applied = 0;
  let delay = 0;
  let timer: { handle: unknown } | null = null;
  let disposed = false;

  // 스냅샷을 돌므로 구독자 안에서 해제·메서드 호출을 해도 안전하다.
  function notify(): void {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  }

  function cancel(): void {
    if (timer === null) return;
    clock.clearTimeout(timer.handle);
    timer = null;
  }

  function finishUnlessError(): void {
    if (status !== 'error') status = 'finished';
  }

  // 취소·교체된 타이머가 뒤늦게 불려도 entry가 달라 아무 일도 하지 않는다.
  function schedule(): void {
    const entry: { handle: unknown } = { handle: null };
    timer = entry;
    entry.handle = clock.setTimeout(() => {
      if (timer !== entry) return;
      timer = null;
      advance();
      notify();
    }, delay);
  }

  // 다음 이벤트 하나를 적용한다. 이미 지난 seq는 세지 않고 곧바로 건너뛰고, seq가 비면 error.
  function applyNext(): boolean {
    while (index < events.length) {
      const event = events[index]!;
      const result = applyEvent(state, event);
      if (result.gap) {
        status = 'error';
        return false;
      }
      index += 1;
      if (result.state === state) continue;
      state = result.state;
      applied += 1;
      delay = delayFor(event);
      return true;
    }
    return false;
  }

  // 다음 위치의 이미 지난 seq(중복)를 상태 변경 없이 건너뛴다. gap이나 새 이벤트에서 멈춘다.
  function skipDuplicates(): void {
    while (index < events.length) {
      const result = applyEvent(state, events[index]!);
      if (result.gap || result.state !== state) return;
      index += 1;
    }
  }

  // 이벤트 하나를 적용하고, 남았으면 직전 이벤트의 delayFor 뒤로 다음을 예약한다.
  function advance(): void {
    if (applyNext()) {
      skipDuplicates();
      if (index < events.length) {
        schedule();
        return;
      }
    }
    finishUnlessError();
  }

  function start(): void {
    if (disposed || status !== 'idle') return;
    status = 'playing';
    advance();
    notify();
  }

  return {
    getState: () => state,
    getStatus: () => status,
    getAppliedCount: () => applied,
    getTotalCount: () => events.length,
    start,
    pause() {
      if (disposed || status !== 'playing') return;
      cancel();
      status = 'paused';
      notify();
    },
    resume() {
      if (disposed || status !== 'paused') return;
      status = 'playing';
      schedule();
      notify();
    },
    skipToEnd() {
      if (disposed || status === 'finished' || status === 'error') return;
      cancel();
      while (applyNext()) {}
      finishUnlessError();
      notify();
    },
    restart() {
      if (disposed) return;
      cancel();
      state = initialMeetingState();
      status = 'idle';
      index = 0;
      applied = 0;
      start();
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      listeners.clear();
    },
  };
}
