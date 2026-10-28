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
  /** 서버가 합의안을 만들어 보냈는가(meeting.agreed 수신). 건너뛰기는 이게 참이어야 한다. */
  isAgreementReady(): boolean;
  /** 지금 건너뛰기를 누를 수 있는가. 재생 중이고 합의안이 도착했을 때만 참(합의안 도착을 따지지 않는 설정이면 재생 중일 때). */
  canSkip(): boolean;
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
  delayFor?: (event: MeetingEvent, state: MeetingState) => number;
  /**
   * 주면 "서버가 합의안을 만드는 데 걸리는 시간"을 흉내 낸다. 이 시간이 지나면(또는 화면이 합의 이벤트까지 재생하면)
   * 합의안이 도착한 것으로 보고, 그 전에는 건너뛰기를 막는다. 생략하면 건너뛰기를 막지 않는다.
   * 실서버에서는 이 값 대신 meeting.agreed 이벤트를 받았을 때 도착으로 바꾼다.
   */
  serverAgreementDelayMs?: number;
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
  let serverTimer: { handle: unknown } | null = null;
  let agreementReady = false;
  let everAgreed = false;
  let disposed = false;
  const gated = options.serverAgreementDelayMs !== undefined;

  function markAgreementReady(): void {
    agreementReady = true;
    everAgreed = true;
  }

  function cancelServer(): void {
    if (serverTimer === null) return;
    clock.clearTimeout(serverTimer.handle);
    serverTimer = null;
  }

  // 모의 서버가 합의안을 보내 오는 시각을 예약한다. 이미 도착했으면 하지 않는다.
  function scheduleServer(): void {
    if (!gated || agreementReady || serverTimer !== null) return;
    const entry: { handle: unknown } = { handle: null };
    serverTimer = entry;
    entry.handle = clock.setTimeout(() => {
      if (serverTimer !== entry) return;
      serverTimer = null;
      markAgreementReady();
      notify();
    }, options.serverAgreementDelayMs ?? 0);
  }

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
      if (event.type === 'meeting.agreed') markAgreementReady();
      applied += 1;
      delay = delayFor(event, state);
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
    scheduleServer();
    advance();
    notify();
  }

  return {
    getState: () => state,
    getStatus: () => status,
    getAppliedCount: () => applied,
    getTotalCount: () => events.length,
    isAgreementReady: () => agreementReady,
    canSkip: () => (status === 'playing' || status === 'paused') && (!gated || agreementReady),
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
      // 서버가 합의안을 보내기 전에는 건너뛸 끝이 없다.
      if (gated && !agreementReady) return;
      cancel();
      while (applyNext()) {}
      finishUnlessError();
      notify();
    },
    restart() {
      if (disposed) return;
      cancel();
      cancelServer();
      // 이미 합의안을 받은 회의를 다시 보는 것이면 처음부터 건너뛸 수 있다.
      agreementReady = everAgreed;
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
      cancelServer();
      listeners.clear();
    },
  };
}
