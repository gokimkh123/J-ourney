import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventPacer, paceDelayMs } from './eventPacer.ts';
import type { EventPacer, PacerClock } from './eventPacer.ts';
import { parseEvent } from './parse.ts';
import { eventDelayMs } from './player.ts';
import type { MeetingEvent, MeetingState, ServerEvent } from './types.ts';

type FakeClock = PacerClock & {
  tick(ms: number): void;
  readonly pendingCount: number;
  readonly maxPending: number;
};

function fakeClock(): FakeClock {
  let nowMs = 0;
  let nextId = 1;
  let maxPending = 0;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => nowMs,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.push({ id, at: nowMs + ms, fn });
      maxPending = Math.max(maxPending, timers.length);
      return id;
    },
    clearTimeout(handle) {
      timers = timers.filter((t) => t.id !== handle);
    },
    tick(ms) {
      const target = nowMs + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        nowMs = Math.max(nowMs, due.at);
        due.fn();
      }
      nowMs = target;
    },
    get pendingCount() {
      return timers.length;
    },
    get maxPending() {
      return maxPending;
    },
  };
}

const DATA: Record<string, unknown> = {
  'agent.message': { agentId: 'a1', round: 1, text: '안녕' },
  'vote.cast': { planId: 'p1', agentId: 'a1', vote: 'yes', score: 80 },
  'round.started': { round: 1, maxRounds: 3 },
  'review.requested': { meetingId: 'm1', items: [], memos: [], total: 1 },
};

function msg(type: string, seq: number): string {
  return JSON.stringify({ type, tripId: 't1', seq, at: '2026-01-01T00:00:00Z', data: DATA[type] });
}

const DELAYS: Record<string, number> = { 'agent.message': 1000, 'vote.cast': 500, 'round.started': 0 };

const PING = JSON.stringify({ type: 'ping' });
const GARBAGE = 'not json';

type Harness = { clock: FakeClock; pacer: EventPacer; out: string[]; log: string[] };

function harness(options: {
  catchUpMs?: number;
  delayAfter?: (event: ServerEvent) => number;
  onDeliver?: (text: string, h: Harness) => void;
} = {}): Harness {
  const clock = fakeClock();
  const out: string[] = [];
  const log: string[] = [];
  const h = { clock, out, log } as Harness;
  h.pacer = createEventPacer({
    clock,
    catchUpMs: options.catchUpMs,
    deliver(text) {
      out.push(text);
      log.push('deliver');
      options.onDeliver?.(text, h);
    },
    delayAfter(event) {
      log.push('delay');
      return options.delayAfter ? options.delayAfter(event) : DELAYS[event.type] ?? 0;
    },
  });
  return h;
}

test('(a) paceDelayMs', () => {
  const events = [msg('agent.message', 1), msg('vote.cast', 2), msg('round.started', 3)];
  for (const text of events) {
    const event = parseEvent(text) as MeetingEvent;
    assert.equal(paceDelayMs(event), eventDelayMs(event));
  }
  assert.equal(paceDelayMs(parseEvent(PING) as ServerEvent), 0);
  assert.equal(paceDelayMs(parseEvent(msg('review.requested', 4)) as ServerEvent), 0);

  const board = { type: 'board.updated', tripId: 't1', seq: 5, at: 'x', data: { candidates: [], agenda: [] } } as MeetingEvent;
  const state = { phase: 'researching' } as MeetingState;
  assert.equal(paceDelayMs(board, state), eventDelayMs(board, state));
  assert.ok(paceDelayMs(board, state) < paceDelayMs(board));
});

test('(b)(k)(h) 첫 이벤트는 즉시, 나머지는 직전 이벤트의 간격으로 한 개씩', () => {
  const { clock, pacer, out } = harness();
  const [A, B, C] = [msg('agent.message', 1), msg('vote.cast', 2), msg('agent.message', 3)];
  pacer.push(A);
  pacer.push(B);
  pacer.push(C);
  assert.deepEqual(out, [A]);
  assert.equal(clock.pendingCount, 1);
  clock.tick(999);
  assert.deepEqual(out, [A]);
  clock.tick(1);
  assert.deepEqual(out, [A, B]);
  clock.tick(499);
  assert.deepEqual(out, [A, B]);
  clock.tick(1);
  assert.deepEqual(out, [A, B, C]);
  assert.equal(clock.pendingCount, 0);
  assert.equal(clock.maxPending, 1);
});

test('(c) 쉬는 시간 0은 기다리지 않는다', () => {
  const { clock, pacer, out } = harness();
  const [A, R, V] = [msg('agent.message', 1), msg('round.started', 2), msg('vote.cast', 3)];
  pacer.push(A);
  pacer.push(R);
  pacer.push(V);
  clock.tick(1000);
  assert.deepEqual(out, [A, R, V]);
  assert.equal(clock.pendingCount, 0);
});

test('(e) 쉬는 시간이 지난 뒤 온 이벤트는 즉시', () => {
  const { clock, pacer, out } = harness();
  const [A, B] = [msg('agent.message', 1), msg('vote.cast', 2)];
  pacer.push(A);
  clock.tick(1000);
  pacer.push(B);
  assert.deepEqual(out, [A, B]);
});

test('(d) ping·읽을 수 없는 글은 줄과 간격에 영향 없이 즉시', () => {
  const { clock, pacer, out } = harness();
  const [A, B] = [msg('agent.message', 1), msg('vote.cast', 2)];
  pacer.push(A);
  pacer.push(B);
  pacer.push(PING);
  pacer.push(GARBAGE);
  assert.deepEqual(out, [A, PING, GARBAGE]);
  clock.tick(999);
  assert.deepEqual(out, [A, PING, GARBAGE]);
  clock.tick(1);
  assert.deepEqual(out, [A, PING, GARBAGE, B]);

  const h = harness();
  h.pacer.push(PING);
  h.pacer.push(msg('agent.message', 1));
  h.pacer.push(msg('vote.cast', 2));
  assert.equal(h.out.length, 2);
  assert.equal(h.clock.pendingCount, 1);
});

test('(f) 따라잡기 구간', () => {
  const { clock, pacer, out, log } = harness({ catchUpMs: 2000 });
  pacer.open();
  const texts = [1, 2, 3].map((n) => msg('agent.message', n));
  texts.forEach((t) => pacer.push(t));
  assert.deepEqual(out, texts);
  assert.equal(clock.pendingCount, 0);
  assert.ok(!log.includes('delay'));
  clock.tick(1999);
  const D = msg('vote.cast', 4);
  pacer.push(D);
  assert.equal(out.length, 4);
  assert.equal(clock.pendingCount, 0);

  clock.tick(1);
  const [E, F] = [msg('agent.message', 5), msg('vote.cast', 6)];
  pacer.push(E);
  pacer.push(F);
  assert.equal(out.length, 5);
  clock.tick(999);
  assert.equal(out.length, 5);
  clock.tick(1);
  assert.deepEqual(out.slice(4), [E, F]);
});

test('(f) open이 없거나 catchUpMs가 0이면 평소대로', () => {
  const noOpen = harness({ catchUpMs: 2000 });
  noOpen.pacer.push(msg('agent.message', 1));
  noOpen.pacer.push(msg('agent.message', 2));
  assert.equal(noOpen.out.length, 1);

  const zero = harness({ catchUpMs: 0 });
  zero.pacer.open();
  zero.pacer.push(msg('agent.message', 1));
  zero.pacer.push(msg('agent.message', 2));
  assert.equal(zero.out.length, 1);
});

test('(f) open을 여러 번 불러도 처음 기준', () => {
  const { clock, pacer, out } = harness({ catchUpMs: 2000 });
  pacer.open();
  clock.tick(1000);
  pacer.open();
  clock.tick(1000);
  pacer.push(msg('agent.message', 1));
  pacer.push(msg('agent.message', 2));
  assert.equal(out.length, 1);
});

test('(f) 구간 안이라도 줄이 비어 있지 않으면 쌓아서 순서를 지킨다', () => {
  const { clock, pacer, out } = harness({ catchUpMs: 5000 });
  const [A, B, C] = [msg('agent.message', 1), msg('vote.cast', 2), msg('agent.message', 3)];
  pacer.push(A);
  pacer.push(B);
  pacer.open();
  pacer.push(C);
  assert.deepEqual(out, [A]);
  clock.tick(1000);
  assert.deepEqual(out, [A, B]);
  clock.tick(500);
  assert.deepEqual(out, [A, B, C]);
});

test('(g) delayAfter는 deliver 뒤에 불리고, 음수·NaN은 0', () => {
  const { log, pacer } = harness();
  pacer.push(msg('agent.message', 1));
  assert.deepEqual(log, ['deliver', 'delay']);

  const values = [-5, Number.NaN, 0];
  let i = 0;
  const h = harness({ delayAfter: () => values[i++] ?? 0 });
  const texts = [1, 2, 3, 4].map((n) => msg('agent.message', n));
  texts.forEach((t) => h.pacer.push(t));
  assert.deepEqual(h.out, texts);
  assert.equal(h.clock.pendingCount, 0);
});

test('(i) dispose는 줄과 타이머를 버리고 이후 입력을 무시한다', () => {
  const { clock, pacer, out } = harness();
  const A = msg('agent.message', 1);
  pacer.push(A);
  pacer.push(msg('vote.cast', 2));
  pacer.push(msg('vote.cast', 3));
  pacer.dispose();
  assert.equal(clock.pendingCount, 0);
  clock.tick(5000);
  assert.deepEqual(out, [A]);
  pacer.push(msg('agent.message', 4));
  pacer.push(PING);
  pacer.push(GARBAGE);
  pacer.open();
  pacer.dispose();
  clock.tick(5000);
  assert.deepEqual(out, [A]);
  assert.equal(clock.pendingCount, 0);
});

test('(i) deliver 안에서 dispose하면 남은 것은 나오지 않는다', () => {
  const B = msg('vote.cast', 2);
  const { clock, pacer, out } = harness({
    onDeliver: (text, h) => {
      if (text === B) h.pacer.dispose();
    },
  });
  pacer.push(msg('agent.message', 1));
  pacer.push(B);
  pacer.push(msg('agent.message', 3));
  clock.tick(1000);
  assert.equal(out.length, 2);
  assert.equal(clock.pendingCount, 0);
  clock.tick(5000);
  assert.equal(out.length, 2);
});

test('(i) delayAfter 안에서 dispose해도 타이머가 남지 않는다', () => {
  const h = {} as { pacer: EventPacer };
  const clock = fakeClock();
  const out: string[] = [];
  h.pacer = createEventPacer({
    clock,
    deliver: (t) => out.push(t),
    delayAfter: () => {
      h.pacer.dispose();
      return 1000;
    },
  });
  h.pacer.push(msg('agent.message', 1));
  h.pacer.push(msg('agent.message', 2));
  clock.tick(5000);
  assert.equal(out.length, 1);
  assert.equal(clock.pendingCount, 0);
});

test('(j)(k) deliver 안에서 push해도 순서·쉬는 시간이 유지된다', () => {
  const [A, B, C] = [msg('agent.message', 1), msg('vote.cast', 2), msg('agent.message', 3)];
  const { clock, pacer, out } = harness({
    onDeliver: (text, h) => {
      if (text === A) h.pacer.push(B);
      if (text === B) h.pacer.push(C);
    },
  });
  pacer.push(A);
  assert.deepEqual(out, [A]);
  assert.equal(clock.pendingCount, 1);
  clock.tick(999);
  assert.deepEqual(out, [A]);
  clock.tick(1);
  assert.deepEqual(out, [A, B]);
  clock.tick(499);
  assert.deepEqual(out, [A, B]);
  clock.tick(1);
  assert.deepEqual(out, [A, B, C]);
  assert.equal(clock.maxPending, 1);
});

test('(j) 따라잡기 구간의 deliver 안에서 push한 이벤트도 쌓여 순서를 지킨다', () => {
  const [A, B] = [msg('agent.message', 1), msg('vote.cast', 2)];
  const { clock, pacer, out } = harness({
    catchUpMs: 1000,
    onDeliver: (text, h) => {
      if (text === A) h.pacer.push(B);
    },
  });
  pacer.open();
  pacer.push(A);
  assert.deepEqual(out, [A, B]);
  assert.equal(clock.pendingCount, 0);
});
