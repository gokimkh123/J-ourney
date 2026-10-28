import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiveFeed, currentRunEvents } from './liveFeed.ts';
import type { FeedClock, SocketHandlers } from './liveFeed.ts';
import { initialMeetingState } from './reducer.ts';
import { nextDelayMs } from './reconnect.ts';
import type { ServerEvent } from './types.ts';

type Pending = { at: number; fn: () => void };

// 손으로 시간을 흘리는 가짜 시계: 예약 목록과 tick(ms)
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const clock: FeedClock = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  function tick(ms: number): void {
    const end = now + ms;
    for (;;) {
      let next: [number, Pending] | undefined;
      for (const entry of pending) {
        if (entry[1].at <= end && (next === undefined || entry[1].at < next[1].at)) next = entry;
      }
      if (next === undefined) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  }
  return {
    clock,
    tick,
    pendingCount: () => pending.size,
    pendingFns: () => [...pending.values()].map((p) => p.fn),
  };
}

type FakeSocket = { afterSeq: number; handlers: SocketHandlers; closed: boolean };
type FakeFetch = { afterSeq: number; resolve(events: ServerEvent[]): void; reject(): void };

const FOREVER = 1e9;
const TRIP = 'trp_1';
const AT = '2026-10-24T14:03:11+09:00';
const agent = { agentId: 'a1', memberId: 'u1', nickname: '민지', title: '탐험가', chips: [], color: '#f00' };
const ping: ServerEvent = { type: 'ping' };
const wire = (event: ServerEvent) => JSON.stringify(event);
// 대기 중인 조회 응답(Promise)이 처리되게 한 번 돌린다. 시간 대기는 아니다.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function started(seq: number): ServerEvent {
  return {
    type: 'meeting.started',
    tripId: TRIP,
    seq,
    at: AT,
    data: { meetingId: `m${seq}`, kind: 'meeting', maxRounds: 3, agents: [agent] },
  };
}

function progress(seq: number): ServerEvent {
  return {
    type: 'research.progress',
    tripId: TRIP,
    seq,
    at: AT,
    data: { agentId: 'a1', stage: 'searching', tool: 'tourSearch', focus: null, foundCount: seq },
  };
}

function message(seq: number): ServerEvent {
  return { type: 'agent.message', tripId: TRIP, seq, at: AT, data: { agentId: 'a1', round: 1, text: `말${seq}` } };
}

function proposed(seq: number): ServerEvent {
  return { type: 'plan.proposed', tripId: TRIP, seq, at: AT, data: { planId: `p${seq}`, version: 1, route: [] } };
}

function setup(opts: { maxReconnects?: number; silenceMs?: number } = {}) {
  const fake = fakeClock();
  const sockets: FakeSocket[] = [];
  const fetches: FakeFetch[] = [];
  const feed = createLiveFeed({
    clock: fake.clock,
    openSocket(afterSeq, handlers) {
      const socket: FakeSocket = { afterSeq, handlers, closed: false };
      sockets.push(socket);
      return {
        close() {
          socket.closed = true;
        },
      };
    },
    fetchEvents(afterSeq) {
      return new Promise<ServerEvent[]>((resolve, reject) => {
        fetches.push({ afterSeq, resolve, reject: () => reject(new Error('조회 실패')) });
      });
    },
    ...opts,
  });
  const calls = { n: 0 };
  feed.subscribe(() => {
    calls.n += 1;
  });
  return { fake, sockets, fetches, feed, calls, last: () => sockets[sockets.length - 1]! };
}

type Env = ReturnType<typeof setup>;

// 조회 성공 → 소켓 onOpen 까지 진행해 live 로 만든다.
async function live(env: Env, events: ServerEvent[] = [started(1)]): Promise<void> {
  env.feed.start();
  env.fetches[0]!.resolve(events);
  await flush();
  env.last().handlers.onOpen();
}

test('(a) currentRunEvents: 마지막 meeting.started 부터, ping 제외, seq 순, 입력 불변', () => {
  const input = [message(5), ping, started(4), progress(2), started(1), proposed(6), message(3)];
  const snapshot = [...input];
  assert.deepEqual(currentRunEvents(input).map((e) => e.seq), [4, 5, 6]);
  assert.equal(input.length, snapshot.length);
  input.forEach((e, i) => assert.equal(e, snapshot[i]));
  assert.deepEqual(currentRunEvents([progress(3), started(1), ping, message(2)]).map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(currentRunEvents([progress(1), ping, message(2)]), []);
  assert.deepEqual(currentRunEvents([]), []);
});

test('(b) start: 마지막 회의만 반영되고 마지막 적용 seq 로 소켓을 연다, 구독자는 적용 전체에 한 번', async () => {
  const env = setup();
  assert.equal(env.feed.getStatus(), 'idle');
  assert.deepEqual(env.feed.getState(), initialMeetingState());
  env.feed.start();
  assert.equal(env.feed.getStatus(), 'syncing');
  assert.equal(env.calls.n, 1);
  assert.deepEqual(env.fetches.map((f) => f.afterSeq), [0]);
  assert.equal(env.sockets.length, 0);
  env.fetches[0]!.resolve([started(1), message(2), proposed(3), started(4), message(5), ping, progress(6)]);
  await flush();
  assert.equal(env.calls.n, 2);
  const state = env.feed.getState();
  assert.equal(state.meetingId, 'm4');
  assert.equal(state.lastSeq, 6);
  assert.deepEqual(state.timeline.map((t) => t.seq), [5]);
  assert.equal(state.latestPlanId, null);
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [6]);
  assert.equal(env.feed.getStatus(), 'syncing');
  env.last().handlers.onOpen();
  assert.equal(env.feed.getStatus(), 'live');
  assert.equal(env.calls.n, 3);
});

test('(b) 조회에 회의가 없으면 가장 큰 seq, 비어 있으면 afterSeq 0', async () => {
  const cases: [ServerEvent[], number][] = [
    [[], 0],
    [[progress(7), ping, message(3)], 7],
  ];
  for (const [events, afterSeq] of cases) {
    const env = setup();
    env.feed.start();
    env.fetches[0]!.resolve(events);
    await flush();
    assert.deepEqual(env.feed.getState(), { ...initialMeetingState(), lastSeq: afterSeq });
    assert.deepEqual(env.sockets.map((s) => s.afterSeq), [afterSeq]);
    assert.equal(env.calls.n, 2);
  }
});

test('(c) 소켓 이벤트가 순서대로 반영되고 이벤트마다 구독자 한 번, 잘못된 글·ping 은 상태 불변', async () => {
  const env = setup();
  await live(env);
  const base = env.calls.n;
  const socket = env.last();
  socket.handlers.onMessage(wire(message(2)));
  assert.equal(env.calls.n, base + 1);
  const before = env.feed.getState();
  socket.handlers.onMessage('not json');
  socket.handlers.onMessage(JSON.stringify({ type: 'unknown.type', tripId: TRIP, seq: 3, at: AT, data: {} }));
  socket.handlers.onMessage(wire(ping));
  assert.equal(env.feed.getState(), before);
  assert.equal(env.calls.n, base + 1);
  socket.handlers.onMessage(wire(proposed(3)));
  socket.handlers.onMessage(wire(message(4)));
  const state = env.feed.getState();
  assert.equal(state.lastSeq, 4);
  assert.deepEqual(state.timeline.map((t) => t.kind), ['message', 'proposal', 'message']);
  assert.equal(env.calls.n, base + 3);
  assert.equal(env.feed.getStatus(), 'live');
  assert.equal(env.sockets.length, 1);
});

test('(d) 지난 seq 는 무시, gap 은 미적용·소켓 close·같은 lastSeq 로 즉시 재연결, 3번 연속이면 failed', async () => {
  const env = setup();
  await live(env);
  const first = env.last();
  first.handlers.onMessage(wire(message(2)));
  const n = env.calls.n;
  const before = env.feed.getState();
  first.handlers.onMessage(wire(message(2)));
  first.handlers.onMessage(wire(started(1)));
  assert.equal(env.feed.getState(), before);
  assert.equal(env.calls.n, n);

  first.handlers.onMessage(wire(message(4)));
  assert.equal(env.feed.getState(), before);
  assert.equal(first.closed, true);
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [1, 2]);
  assert.equal(env.fake.pendingCount(), 0);
  assert.equal(env.feed.getStatus(), 'reconnecting');
  first.handlers.onClose(1006, '');
  assert.equal(env.fake.pendingCount(), 0);

  env.last().handlers.onOpen();
  env.last().handlers.onMessage(wire(message(4)));
  env.last().handlers.onOpen();
  env.last().handlers.onMessage(wire(message(5)));
  assert.equal(env.feed.getStatus(), 'failed');
  assert.equal(env.sockets.length, 3);
  assert.equal(env.last().closed, true);
  assert.equal(env.feed.getState(), before);
  env.fake.tick(FOREVER);
  assert.equal(env.sockets.length, 3);
});

test('(d) lastSeq 가 전진하면 gap 횟수를 다시 센다', async () => {
  const env = setup();
  await live(env);
  env.last().handlers.onMessage(wire(message(3)));
  env.last().handlers.onOpen();
  env.last().handlers.onMessage(wire(message(3)));
  env.last().handlers.onOpen();
  env.last().handlers.onMessage(wire(message(2)));
  env.last().handlers.onMessage(wire(message(4)));
  env.last().handlers.onOpen();
  env.last().handlers.onMessage(wire(message(4)));
  assert.equal(env.feed.getStatus(), 'reconnecting');
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [1, 1, 1, 2, 2]);
});

test('(e) 1006 닫힘은 1초·2초·4초 뒤 재연결, 메시지를 받으면 다시 1초, maxReconnects 초과면 failed', async () => {
  const env = setup({ maxReconnects: 3 });
  await live(env);
  const closeAndWait = (delay: number) => {
    const count = env.sockets.length;
    env.last().handlers.onClose(1006, '');
    assert.equal(env.feed.getStatus(), 'reconnecting');
    env.fake.tick(delay - 1);
    assert.equal(env.sockets.length, count);
    env.fake.tick(1);
    assert.equal(env.sockets.length, count + 1);
    assert.equal(env.last().afterSeq, env.feed.getState().lastSeq);
  };
  closeAndWait(1000);
  closeAndWait(2000);
  env.last().handlers.onOpen();
  env.last().handlers.onMessage(wire(ping));
  closeAndWait(1000);
  closeAndWait(2000);
  closeAndWait(4000);
  env.last().handlers.onClose(1011, 'error');
  assert.equal(env.feed.getStatus(), 'failed');
  assert.equal(env.fake.pendingCount(), 0);
  const count = env.sockets.length;
  env.fake.tick(FOREVER);
  assert.equal(env.sockets.length, count);
  assert.equal(env.fetches.length, 1);
});

test('(e) maxReconnects 기본값은 8', async () => {
  const env = setup();
  await live(env);
  for (let i = 0; i < 8; i++) {
    env.last().handlers.onClose(1006, '');
    env.fake.tick(nextDelayMs(i));
  }
  assert.equal(env.sockets.length, 9);
  env.last().handlers.onClose(1006, '');
  assert.equal(env.feed.getStatus(), 'failed');
});

test('(f) 4000 은 replaced 로 멈추고 시간이 흘러도 다시 열지 않는다', async () => {
  const env = setup();
  await live(env);
  env.last().handlers.onClose(4000, 'replaced');
  assert.equal(env.feed.getStatus(), 'replaced');
  assert.equal(env.fake.pendingCount(), 0);
  env.fake.tick(FOREVER);
  env.feed.start();
  env.feed.wake();
  assert.equal(env.sockets.length, 1);
  assert.equal(env.feed.getStatus(), 'replaced');
});

test('(g) 무소식이 silenceMs 를 넘으면 소켓을 닫고 재연결, ping 이 오면 그 시점부터 다시 잰다', async () => {
  const env = setup({ silenceMs: 5000 });
  await live(env);
  const first = env.last();
  env.fake.tick(4000);
  first.handlers.onMessage(wire(ping));
  env.fake.tick(4999);
  assert.equal(first.closed, false);
  assert.equal(env.feed.getStatus(), 'live');
  env.fake.tick(1);
  assert.equal(first.closed, true);
  assert.equal(env.feed.getStatus(), 'reconnecting');
  assert.equal(env.sockets.length, 1);
  env.fake.tick(1000);
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [1, 1]);
  assert.equal(env.fetches.length, 1);
});

test('(h) suspend 는 소켓·타이머를 모두 거두고, wake 는 대기 없이 마지막 seq 로 다시 연다', async () => {
  const env = setup();
  await live(env);
  const first = env.last();
  first.handlers.onMessage(wire(message(2)));
  env.feed.suspend();
  assert.equal(env.feed.getStatus(), 'suspended');
  assert.equal(first.closed, true);
  assert.equal(env.fake.pendingCount(), 0);
  const n = env.calls.n;
  const before = env.feed.getState();
  first.handlers.onOpen();
  first.handlers.onMessage(wire(message(3)));
  first.handlers.onClose(1006, '');
  env.fake.tick(FOREVER);
  assert.equal(env.sockets.length, 1);
  assert.equal(env.feed.getState(), before);
  assert.equal(env.feed.getStatus(), 'suspended');
  assert.equal(env.calls.n, n);

  env.feed.wake();
  assert.equal(env.feed.getStatus(), 'reconnecting');
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [1, 2]);
  env.last().handlers.onOpen();
  assert.equal(env.feed.getStatus(), 'live');
  assert.equal(env.fetches.length, 1);

  // reconnecting 중 suspend: 재연결 타이머 취소, 실패 횟수 0
  env.last().handlers.onClose(1006, '');
  env.fake.tick(1000);
  env.last().handlers.onClose(1006, '');
  env.feed.suspend();
  assert.equal(env.fake.pendingCount(), 0);
  env.fake.tick(FOREVER);
  assert.equal(env.sockets.length, 3);
  env.feed.wake();
  assert.equal(env.sockets.length, 4);
  env.last().handlers.onClose(1006, '');
  env.fake.tick(999);
  assert.equal(env.sockets.length, 4);
  env.fake.tick(1);
  assert.equal(env.sockets.length, 5);
});

test('(i) 교체된 낡은 소켓의 콜백은 상태·status·재연결 횟수·구독자에 영향이 없다', async () => {
  const env = setup();
  await live(env);
  const old = env.last();
  old.handlers.onClose(1006, '');
  env.fake.tick(1000);
  const current = env.last();
  const n = env.calls.n;
  const before = env.feed.getState();
  old.handlers.onOpen();
  old.handlers.onMessage(wire(message(2)));
  old.handlers.onClose(1006, '');
  assert.equal(env.feed.getStatus(), 'reconnecting');
  assert.equal(env.feed.getState(), before);
  assert.equal(env.calls.n, n);
  assert.equal(env.fake.pendingCount(), 0);
  // 낡은 메시지가 실패 횟수를 되돌리지 않았으므로 두 번째 실패는 2초
  current.handlers.onClose(1006, '');
  env.fake.tick(1999);
  assert.equal(env.sockets.length, 2);
  env.fake.tick(1);
  assert.equal(env.sockets.length, 3);
});

test('(j) 조회 거절은 연결 실패와 같은 재시도 규칙, 동기화 전이면 조회부터 다시', async () => {
  const env = setup({ maxReconnects: 2 });
  env.feed.start();
  env.fetches[0]!.reject();
  await flush();
  assert.equal(env.feed.getStatus(), 'reconnecting');
  env.fake.tick(999);
  assert.equal(env.fetches.length, 1);
  env.fake.tick(1);
  assert.deepEqual(env.fetches.map((f) => f.afterSeq), [0, 0]);
  assert.equal(env.sockets.length, 0);
  env.fetches[1]!.reject();
  await flush();
  env.fake.tick(1999);
  assert.equal(env.fetches.length, 2);
  env.fake.tick(1);
  assert.equal(env.fetches.length, 3);
  env.fetches[2]!.reject();
  await flush();
  assert.equal(env.feed.getStatus(), 'failed');
  env.fake.tick(FOREVER);
  assert.equal(env.fetches.length, 3);
  assert.equal(env.sockets.length, 0);
});

test('(j) dispose·suspend 뒤에 늦게 성공한 조회는 무시된다', async () => {
  for (const stop of ['dispose', 'suspend'] as const) {
    const env = setup();
    env.feed.start();
    env.feed[stop]();
    const n = env.calls.n;
    env.fetches[0]!.resolve([started(1)]);
    await flush();
    assert.equal(env.sockets.length, 0);
    assert.deepEqual(env.feed.getState(), initialMeetingState());
    assert.equal(env.calls.n, n);
    assert.equal(env.feed.getStatus(), stop === 'dispose' ? 'disposed' : 'suspended');
  }
  // 동기화 전에 suspend 했다면 wake 는 조회부터 다시 하고 옛 응답은 버린다
  const env = setup();
  env.feed.start();
  env.feed.suspend();
  env.feed.wake();
  assert.equal(env.fetches.length, 2);
  env.fetches[0]!.resolve([started(1)]);
  env.fetches[1]!.resolve([started(1), message(2)]);
  await flush();
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [2]);
});

test('(k) dispose 뒤에는 어떤 호출·타이머·옛 콜백도 상태를 바꾸지 않고 구독자도 안 불린다', async () => {
  const env = setup();
  await live(env);
  const socket = env.last();
  socket.handlers.onMessage(wire(message(2)));
  const stale = env.fake.pendingFns();
  assert.equal(stale.length, 1);
  const before = env.feed.getState();
  const n = env.calls.n;
  env.feed.dispose();
  env.feed.dispose();
  assert.equal(env.feed.getStatus(), 'disposed');
  assert.equal(socket.closed, true);
  assert.equal(env.fake.pendingCount(), 0);
  const late = { n: 0 };
  const off = env.feed.subscribe(() => {
    late.n += 1;
  });
  off();
  env.feed.start();
  env.feed.suspend();
  env.feed.wake();
  socket.handlers.onOpen();
  socket.handlers.onMessage(wire(message(3)));
  socket.handlers.onClose(1006, '');
  for (const fn of stale) fn();
  env.fake.tick(FOREVER);
  assert.equal(env.feed.getState(), before);
  assert.equal(env.feed.getStatus(), 'disposed');
  assert.equal(env.calls.n, n);
  assert.equal(late.n, 0);
  assert.equal(env.sockets.length, 1);
  assert.equal(env.fetches.length, 1);
  assert.equal(env.fake.pendingCount(), 0);
});

test('(l) 구독자가 안에서 자신을 해제하거나 dispose·suspend 를 불러도 깨지지 않는다', async () => {
  const env = setup();
  const seen = { self: 0, other: 0 };
  const off = env.feed.subscribe(() => {
    seen.self += 1;
    off();
  });
  env.feed.subscribe(() => {
    seen.other += 1;
  });
  env.feed.start();
  assert.deepEqual(seen, { self: 1, other: 1 });
  env.fetches[0]!.resolve([started(1)]);
  await flush();
  assert.deepEqual(seen, { self: 1, other: 2 });
  assert.equal(env.feed.getState().lastSeq, 1);

  // 구독자가 dispose: 적용된 상태는 그대로, 아직 안 불린 구독자는 불리지 않고 남는 것이 없다
  const env2 = setup();
  await live(env2);
  const third = { n: 0 };
  env2.feed.subscribe(() => env2.feed.dispose());
  env2.feed.subscribe(() => {
    third.n += 1;
  });
  env2.last().handlers.onMessage(wire(message(2)));
  assert.equal(env2.feed.getState().lastSeq, 2);
  assert.equal(env2.feed.getStatus(), 'disposed');
  assert.equal(third.n, 0);
  assert.equal(env2.last().closed, true);
  assert.equal(env2.fake.pendingCount(), 0);

  // live 통지 안에서 suspend 해도 무소식 타이머가 남지 않는다
  const env3 = setup();
  env3.feed.subscribe(() => {
    if (env3.feed.getStatus() === 'live') env3.feed.suspend();
  });
  await live(env3);
  assert.equal(env3.feed.getStatus(), 'suspended');
  assert.equal(env3.last().closed, true);
  assert.equal(env3.fake.pendingCount(), 0);
});

test('(m) start 를 두 번 불러도 조회와 소켓은 한 번씩만', async () => {
  const env = setup();
  env.feed.start();
  env.feed.start();
  assert.equal(env.fetches.length, 1);
  env.fetches[0]!.resolve([started(1)]);
  await flush();
  env.feed.start();
  env.last().handlers.onOpen();
  env.feed.start();
  assert.equal(env.fetches.length, 1);
  assert.equal(env.sockets.length, 1);
  assert.equal(env.feed.getStatus(), 'live');
});

// openSocket 이 반환하기 전에 onOpen 을 동기로 부르는 소켓 환경. syncFrom 번째 소켓부터 동기로 연다.
function syncOpenEnv(syncFrom: number) {
  const fake = fakeClock();
  const sockets: FakeSocket[] = [];
  const feed = createLiveFeed({
    clock: fake.clock,
    openSocket(afterSeq, handlers) {
      const socket: FakeSocket = { afterSeq, handlers, closed: false };
      sockets.push(socket);
      if (sockets.length > syncFrom) handlers.onOpen();
      return {
        close() {
          socket.closed = true;
        },
      };
    },
    fetchEvents: () => Promise.resolve([started(1)]),
  });
  return { fake, sockets, feed };
}

test('(n) 소켓 생성 중 동기 onOpen 의 live 통지에서 suspend 하면 반환된 소켓도 닫히고 타이머가 없다', async () => {
  const env = syncOpenEnv(0);
  env.feed.subscribe(() => {
    if (env.feed.getStatus() === 'live') env.feed.suspend();
  });
  env.feed.start();
  await flush();
  assert.equal(env.feed.getStatus(), 'suspended');
  assert.equal(env.sockets.length, 1);
  assert.equal(env.sockets[0]!.closed, true);
  assert.equal(env.fake.pendingCount(), 0);
});

test('(n) 소켓 생성 중 동기 onOpen 의 live 통지에서 dispose 하면 반환된 소켓도 닫히고 disposed', async () => {
  const env = syncOpenEnv(0);
  env.feed.subscribe(() => {
    if (env.feed.getStatus() === 'live') env.feed.dispose();
  });
  env.feed.start();
  await flush();
  assert.equal(env.feed.getStatus(), 'disposed');
  assert.equal(env.sockets[0]!.closed, true);
  assert.equal(env.fake.pendingCount(), 0);
});

test('(n) gap 재연결한 새 소켓의 동기 onOpen 통지에서 suspend 해도 suspended 가 덮어쓰이지 않는다', async () => {
  const env = syncOpenEnv(1);
  env.feed.subscribe(() => {
    if (env.sockets.length >= 2 && env.feed.getStatus() === 'live') env.feed.suspend();
  });
  env.feed.start();
  await flush();
  env.sockets[0]!.handlers.onOpen();
  assert.equal(env.feed.getStatus(), 'live');
  env.sockets[0]!.handlers.onMessage(wire(message(3)));
  assert.equal(env.sockets.length, 2);
  assert.equal(env.sockets[0]!.closed, true);
  assert.equal(env.sockets[1]!.closed, true);
  assert.equal(env.feed.getStatus(), 'suspended');
  assert.equal(env.fake.pendingCount(), 0);
  env.fake.tick(FOREVER);
  assert.equal(env.sockets.length, 2);
});

// wake 의 reconnecting 통지에서 구독자가 한 번만 suspend → wake 를 부르게 한다.
function reenterOnReconnecting(env: Env): void {
  let done = false;
  env.feed.subscribe(() => {
    if (done || env.feed.getStatus() !== 'reconnecting') return;
    done = true;
    env.feed.suspend();
    env.feed.wake();
  });
}

test('(o) 동기화 전 wake 통지에서 suspend → wake 를 불러도 조회는 한 번만 다시 시작된다', async () => {
  const env = setup();
  env.feed.start();
  env.feed.suspend();
  reenterOnReconnecting(env);
  env.feed.wake();
  assert.equal(env.fetches.length, 2);
  env.fetches[0]!.resolve([started(1)]);
  env.fetches[1]!.resolve([started(1), message(2)]);
  await flush();
  assert.equal(env.fetches.length, 2);
  assert.deepEqual(env.sockets.map((s) => s.afterSeq), [2]);
  assert.equal(env.feed.getState().lastSeq, 2);
});

test('(o) 동기화 후 wake 통지에서 suspend → wake 를 불러도 소켓은 한 번만 열리고 하나만 남는다', async () => {
  const env = setup();
  await live(env);
  env.feed.suspend();
  assert.equal(env.sockets.length, 1);
  reenterOnReconnecting(env);
  env.feed.wake();
  assert.equal(env.sockets.length, 2);
  assert.equal(env.sockets.filter((s) => !s.closed).length, 1);
  assert.equal(env.fetches.length, 1);
  env.last().handlers.onOpen();
  assert.equal(env.feed.getStatus(), 'live');
});
