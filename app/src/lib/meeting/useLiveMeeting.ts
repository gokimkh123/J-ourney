import { useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { endpoints } from '../api/index.ts';
import { config } from '../config/index.ts';
import type { Session } from '../session/session.ts';
import { droppedEventNote } from './droppedEvent.ts';
import { createEventPacer, paceDelayMs } from './eventPacer.ts';
import { createLiveFeed } from './liveFeed.ts';
import type { FeedStatus, LiveFeed } from './liveFeed.ts';
import { initialMeetingState } from './reducer.ts';
import { buildWsUrl } from './reconnect.ts';
import type { MeetingState } from './types.ts';

const clock = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const paceClock = { ...clock, now: () => Date.now() };

// 다시 붙은 직후 서버가 놓친 이벤트를 몰아 보내 주는 구간. 이미 일어난 일이라 쉬지 않고 보여 준다.
const CATCH_UP_MS = 1000;

export type LiveMeeting = { state: MeetingState; feedStatus: FeedStatus };

/**
 * 실서버 회의 이벤트를 받아 회의 상태로 만든다. enabled가 켜지면 연결하고, 화면이 사라지면 정리한다.
 * 앱이 백그라운드로 가면 연결을 접고 돌아오면 마지막으로 받은 자리부터 다시 붙는다.
 */
export function useLiveMeeting(enabled: boolean, session: Session | null): LiveMeeting {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<LiveFeed | null>(null);
  const tripId = session?.tripId ?? null;
  const token = session?.token ?? null;

  useEffect(() => {
    if (!enabled || tripId === null || token === null) return;
    let opens = 0;
    const feed: LiveFeed = createLiveFeed({
      clock,
      fetchEvents: (afterSeq) => endpoints.getEvents(tripId, afterSeq),
      openSocket(afterSeq, handlers) {
        const reconnected = opens > 0;
        opens += 1;
        const ws = new WebSocket(buildWsUrl({ baseUrl: config.apiBaseUrl, tripId, token, afterSeq }));
        // 서버가 이벤트를 한꺼번에 보내도 목업처럼 쉬어 가며 보여 준다. 연결마다 하나라서 닫히면 쌓인 것은 버려지고,
        // 다시 붙을 때 서버가 마지막으로 반영한 자리 뒤부터 다시 보내 준다.
        const pacer = createEventPacer({
          clock: paceClock,
          deliver: handlers.onMessage,
          delayAfter: (event) => paceDelayMs(event, feed.getState()),
          catchUpMs: reconnected ? CATCH_UP_MS : 0,
        });
        ws.onopen = () => {
          pacer.open();
          handlers.onOpen();
        };
        ws.onmessage = (e) => {
          const text = typeof e.data === 'string' ? e.data : String(e.data);
          // 앱이 모르는 이벤트는 조용히 버려지므로 종류와 번호만 터미널(Metro)에 남긴다.
          const dropped = droppedEventNote(text);
          if (dropped !== null) console.log(`[live] ${dropped}`);
          pacer.push(text);
        };
        // 닫히기 전에 오류가 나도 close가 뒤따라 온다.
        ws.onerror = () => {};
        ws.onclose = (e) => {
          pacer.dispose();
          handlers.onClose(e.code, e.reason ?? '');
        };
        return {
          close: () => {
            pacer.dispose();
            ws.close();
          },
        };
      },
    });
    ref.current = feed;
    const off = feed.subscribe(rerender);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') feed.wake();
      else if (next === 'background') feed.suspend();
    });
    feed.start();
    rerender();
    return () => {
      sub.remove();
      off();
      feed.dispose();
      if (ref.current === feed) ref.current = null;
    };
  }, [enabled, tripId, token]);

  const feed = ref.current;
  return { state: feed?.getState() ?? initialMeetingState(), feedStatus: feed?.getStatus() ?? 'idle' };
}
