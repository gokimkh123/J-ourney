import { useEffect, useReducer, useRef } from 'react';

import { busanEvents } from './fixtures/busan.ts';
import { eventsUntilFirstAgreed } from './player.ts';
import { createPlayback } from './playback.ts';
import type { Playback, PlaybackStatus } from './playback.ts';
import { initialMeetingState } from './reducer.ts';
import type { MeetingState } from './types.ts';

const EVENTS = eventsUntilFirstAgreed(busanEvents);

// 모의 서버가 합의안을 만들어 보내는 데 걸리는 시간(ms). 실서버가 붙으면 meeting.agreed 수신으로 바뀐다.
// 화면 재생(약 50초)보다 짧게 두어, 재생 도중에 합의안이 도착하면 건너뛰기가 켜지는 것을 보여 준다.
export const MOCK_SERVER_AGREEMENT_MS = 20_000;

const clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type MeetingPlayback = {
  state: MeetingState;
  status: PlaybackStatus;
  applied: number;
  total: number;
  /** 서버(지금은 모의)가 합의안을 보내 와서 건너뛸 수 있는가 */
  canSkip: boolean;
  pause(): void;
  resume(): void;
  skipToEnd(): void;
  restart(): void;
};

/**
 * 가짜 회의(부산 예시)를 처음부터 재생한다. enabled가 켜지거나 restartKey가 바뀌면 새로 시작하고,
 * 화면이 사라지면 타이머를 정리한다. 서버가 열리면 이 훅만 실제 이벤트 수신으로 바꾼다.
 */
export function useMeetingPlayback(enabled: boolean, restartKey: unknown): MeetingPlayback {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<Playback | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const playback = createPlayback({ events: EVENTS, clock, serverAgreementDelayMs: MOCK_SERVER_AGREEMENT_MS });
    ref.current = playback;
    const off = playback.subscribe(rerender);
    playback.start();
    rerender();
    return () => {
      off();
      playback.dispose();
      if (ref.current === playback) ref.current = null;
    };
  }, [enabled, restartKey]);

  const playback = ref.current;
  return {
    state: playback?.getState() ?? initialMeetingState(),
    status: playback?.getStatus() ?? 'idle',
    applied: playback?.getAppliedCount() ?? 0,
    total: playback?.getTotalCount() ?? EVENTS.length,
    canSkip: playback?.canSkip() ?? false,
    pause: () => playback?.pause(),
    resume: () => playback?.resume(),
    skipToEnd: () => playback?.skipToEnd(),
    restart: () => playback?.restart(),
  };
}
