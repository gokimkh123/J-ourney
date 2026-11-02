import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiveFeed } from './liveFeed.ts';
import { liveBanner, liveProgress } from './liveView.ts';
import type { FeedClock, SocketHandlers } from './liveFeed.ts';
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


// v2.4 실시간 연결 닫힘 코드: 4001 파티 나감, 4004 파티 없어짐 → 다시 붙지 않는다
for (const [code, status] of [[4001, 'left'], [4004, 'deleted']] as const) {
  test(`${code}이면 ${status}로 멈추고 시간이 흘러도·wake 해도 다시 열지 않는다`, async () => {
    const env = setup();
    await live(env);
    env.last().handlers.onClose(code, status);
    assert.equal(env.feed.getStatus(), status);
    assert.equal(env.fake.pendingCount(), 0);
    env.fake.tick(FOREVER);
    env.feed.start();
    env.feed.wake();
    assert.equal(env.sockets.length, 1);
    assert.equal(env.fetches.length, 1);
    assert.equal(env.feed.getStatus(), status);
  });
}

test('left·deleted: 회의 화면은 오류로 보고 까닭을 알린다', () => {
  assert.equal(liveProgress('left', 'researching'), 'error');
  assert.equal(liveProgress('deleted', 'agreed'), 'error');
  assert.equal(liveBanner('left'), '이 파티에서 나가서 회의 연결이 끊겼어요');
  assert.equal(liveBanner('deleted'), '방장이 파티를 없앴어요');
});

test('다른 닫힘 코드(1006)는 예전처럼 다시 붙는다', async () => {
  const env = setup();
  await live(env);
  env.last().handlers.onClose(1006, '');
  assert.equal(env.feed.getStatus(), 'reconnecting');
});
