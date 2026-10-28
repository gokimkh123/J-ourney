import { parseEvent } from './parse.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import { nextDelayMs } from './reconnect.ts';
import type { MeetingEvent, MeetingState, ReviewEvent, ServerEvent } from './types.ts';

export type FeedClock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type FeedStatus =
  | 'idle'
  | 'syncing'
  | 'live'
  | 'reconnecting'
  | 'suspended'
  | 'replaced'
  | 'failed'
  | 'disposed';

export type SocketHandlers = {
  onOpen(): void;
  onMessage(text: string): void;
  onClose(code: number, reason: string): void;
};

export type SocketHandle = { close(): void };

export type LiveFeed = {
  getState(): MeetingState;
  getStatus(): FeedStatus;
  subscribe(listener: () => void): () => void;
  /** idle 일 때만: 전체 이벤트를 조회해 마지막 회의를 만들고 소켓을 연다. */
  start(): void;
  /** live·syncing·reconnecting 일 때: 소켓과 타이머를 모두 거두고 suspended. */
  suspend(): void;
  /** suspended 일 때만: 대기 없이 마지막 seq 로 다시 붙는다. */
  wake(): void;
  dispose(): void;
};

// 같은 구성원이 연결을 더 열어 서버가 쫓아낸 코드. 다시 붙으면 서로 쫓아낸다.
const REPLACED_CODE = 4000;
const MAX_GAPS = 3;

/** ping 을 버리고 seq 순으로 정렬해 마지막 meeting.started 부터 자른다. 없으면 빈 배열. */
export function currentRunEvents(events: ServerEvent[]): (MeetingEvent | ReviewEvent)[] {
  const sorted = events
    .filter((event): event is MeetingEvent | ReviewEvent => event.type !== 'ping')
    .sort((a, b) => a.seq - b.seq);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.type === 'meeting.started') return sorted.slice(i);
  }
  return [];
}

type Timer = { handle: unknown };
type Connection = { handle: SocketHandle | null };

export function createLiveFeed(options: {
  clock: FeedClock;
  openSocket(afterSeq: number, handlers: SocketHandlers): SocketHandle;
  fetchEvents(afterSeq: number): Promise<ServerEvent[]>;
  maxReconnects?: number;
  silenceMs?: number;
}): LiveFeed {
  const clock = options.clock;
  const maxReconnects = options.maxReconnects ?? 8;
  const silenceMs = options.silenceMs ?? 60000;
  const listeners = new Set<() => void>();
  let state = initialMeetingState();
  let status: FeedStatus = 'idle';
  let conn: Connection | null = null;
  let retry: Timer | null = null;
  let silence: Timer | null = null;
  // 조회 세대. 바뀌면 늦게 도착한 응답은 버린다.
  let token = 0;
  let synced = false;
  let failures = 0;
  let gapSeq = -1;
  let gaps = 0;

  // 스냅샷을 돌므로 구독자 안에서 해제·메서드 호출을 해도 안전하다.
  function notify(): void {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  }

  function setStatus(next: FeedStatus): void {
    if (status === next) return;
    status = next;
    notify();
  }

  function clear(timer: Timer | null): null {
    if (timer !== null) clock.clearTimeout(timer.handle);
    return null;
  }

  // 현재 소켓을 버린다. 그 소켓의 이후 콜백은 entry 가 달라 무시된다.
  function closeSocket(): void {
    silence = clear(silence);
    if (conn === null) return;
    const entry = conn;
    conn = null;
    entry.handle?.close();
  }

  function stop(next: FeedStatus): void {
    retry = clear(retry);
    closeSocket();
    token += 1;
    setStatus(next);
  }

  function armSilence(): void {
    silence = clear(silence);
    const entry: Timer = { handle: null };
    silence = entry;
    entry.handle = clock.setTimeout(() => {
      if (silence !== entry) return;
      silence = null;
      closeSocket();
      fail();
    }, silenceMs);
  }

  // 연결·조회 실패: 횟수를 올려 지수 대기 뒤 다시 하고, 한도를 넘으면 포기한다.
  function fail(): void {
    failures += 1;
    if (failures > maxReconnects) {
      stop('failed');
      return;
    }
    const entry: Timer = { handle: null };
    retry = entry;
    entry.handle = clock.setTimeout(() => {
      if (retry !== entry) return;
      retry = null;
      resume();
    }, nextDelayMs(failures - 1));
    setStatus('reconnecting');
  }

  // 최초 동기화를 끝냈으면 소켓만, 아니면 조회부터 다시 한다.
  function resume(): void {
    if (synced) connect();
    else sync();
  }

  function sync(): void {
    const mine = ++token;
    void options.fetchEvents(0).then(
      (events) => {
        if (mine === token) applySync(events, mine);
      },
      () => {
        if (mine === token) fail();
      },
    );
  }

  function applySync(events: ServerEvent[], mine: number): void {
    const run = currentRunEvents(events);
    if (run.length === 0) {
      let lastSeq = 0;
      for (const event of events) {
        if (event.type !== 'ping' && event.seq > lastSeq) lastSeq = event.seq;
      }
      state = { ...initialMeetingState(), lastSeq };
    } else {
      let next: MeetingState = { ...initialMeetingState(), lastSeq: run[0]!.seq - 1 };
      for (const event of run) next = applyEvent(next, event).state;
      state = next;
    }
    synced = true;
    notify();
    // 구독자가 통지 안에서 멈추거나 정리했다면(세대가 바뀜) 연결하지 않는다.
    if (mine === token) connect();
  }

  function connect(): void {
    const entry: Connection = { handle: null };
    conn = entry;
    const handle = options.openSocket(state.lastSeq, {
      onOpen() {
        if (conn !== entry) return;
        armSilence();
        setStatus('live');
      },
      onMessage(text) {
        if (conn === entry) receive(text);
      },
      onClose(code) {
        if (conn !== entry) return;
        conn = null;
        silence = clear(silence);
        if (code === REPLACED_CODE) stop('replaced');
        else fail();
      },
    });
    // openSocket 도중 동기 콜백이 이 연결을 이미 버렸다면 방금 받은 소켓도 닫는다.
    if (conn !== entry) {
      handle.close();
      return;
    }
    entry.handle = handle;
  }

  function receive(text: string): void {
    const event = parseEvent(text);
    if (event === null) return;
    failures = 0;
    armSilence();
    const result = applyEvent(state, event);
    if (result.gap) {
      reconnectAfterGap();
      return;
    }
    if (result.state === state) return;
    state = result.state;
    notify();
  }

  // 건너뛴 seq: 적용하지 않고 같은 lastSeq 로 곧바로 다시 붙는다. 같은 자리에서 3번째면 포기.
  function reconnectAfterGap(): void {
    if (gapSeq !== state.lastSeq) {
      gapSeq = state.lastSeq;
      gaps = 0;
    }
    gaps += 1;
    if (gaps >= MAX_GAPS) {
      stop('failed');
      return;
    }
    closeSocket();
    setStatus('reconnecting');
    // 통지 안에서 멈췄거나 이미 다시 붙었다면 연결하지 않는다.
    if (status === 'reconnecting' && conn === null) connect();
  }

  return {
    getState: () => state,
    getStatus: () => status,
    subscribe(listener) {
      if (status === 'disposed') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (status !== 'idle') return;
      status = 'syncing';
      sync();
      notify();
    },
    suspend() {
      if (status !== 'live' && status !== 'syncing' && status !== 'reconnecting') return;
      failures = 0;
      stop('suspended');
    },
    wake() {
      if (status !== 'suspended') return;
      const mine = token;
      status = 'reconnecting';
      notify();
      // 통지 안에서 멈추거나 다시 깨웠다면(세대가 바뀜) 바깥 wake 는 이어서 연결하지 않는다.
      if (mine === token && status === 'reconnecting' && conn === null) resume();
    },
    dispose() {
      if (status === 'disposed') return;
      listeners.clear();
      stop('disposed');
    },
  };
}
