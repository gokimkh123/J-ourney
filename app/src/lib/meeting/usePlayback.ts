import { useEffect, useReducer, useRef } from 'react';

import { busanEvents } from './fixtures/busan.ts';
import { eventsUntilFirstAgreed } from './player.ts';
import { createPlayback } from './playback.ts';
import type { Playback, PlaybackStatus } from './playback.ts';
import { initialMeetingState } from './reducer.ts';
import type { MeetingState } from './types.ts';

const EVENTS = eventsUntilFirstAgreed(busanEvents);

const clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type MeetingPlayback = {
  state: MeetingState;
  status: PlaybackStatus;
  applied: number;
  total: number;
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
    const playback = createPlayback({ events: EVENTS, clock });
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
    pause: () => playback?.pause(),
    resume: () => playback?.resume(),
    skipToEnd: () => playback?.skipToEnd(),
    restart: () => playback?.restart(),
  };
}
