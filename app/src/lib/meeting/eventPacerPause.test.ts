import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventPacer, wakesPause } from './eventPacer.ts';
import { parseEvent } from './parse.ts';

// 실서버 회의 보기 일시정지(11/2): 멈춤·계속·지금으로·사람 차례에 자동으로 풀기

function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(handle: unknown) {
      timers = timers.filter((t) => t.id !== handle);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
      }
      now = end;
    },
    pending: () => timers.length,
  };
}

const msg = (seq: number, type = 'agent.message') =>
  JSON.stringify({ type, tripId: 't', seq, at: 'x', data: type === 'agent.message' ? { agentId: 'a', round: 1, text: `말${seq}` } : { meetingId: 'm', items: [], memos: [], total: 2 } });
const seqOf = (text: string) => (JSON.parse(text) as { seq: number }).seq;

function setup(options: { paused?: boolean } = {}) {
  const clock = fakeClock();
  const got: number[] = [];
  let woke = 0;
  const pacer = createEventPacer({
    clock,
    deliver: (t) => got.push(seqOf(t)),
    delayAfter: () => 1000,
    wakeOn: wakesPause,
    onWake: () => {
      woke += 1;
    },
    ...(options.paused === true && { paused: true }),
  });
  return { clock, got, pacer, woke: () => woke };
}

test('멈추면 쌓기만 하고, 계속하면 멈춘 자리부터 평소 간격으로', () => {
  const { clock, got, pacer } = setup();
  pacer.push(msg(1));
  pacer.pause();
  pacer.push(msg(2));
  pacer.push(msg(3));
  clock.advance(5000);
  assert.deepEqual(got, [1]);
  assert.equal(pacer.queued(), 2);
  assert.equal(clock.pending(), 0);
  pacer.resume();
  assert.deepEqual(got, [1, 2]);
  clock.advance(999);
  assert.deepEqual(got, [1, 2]);
  clock.advance(1);
  assert.deepEqual(got, [1, 2, 3]);
});

test('쉬는 중에 멈추면 대기 타이머를 지우고, 계속하면 바로 다음을 넘긴다', () => {
  const { clock, got, pacer } = setup();
  pacer.push(msg(1));
  pacer.push(msg(2));
  assert.equal(clock.pending(), 1);
  pacer.pause();
  assert.equal(clock.pending(), 0);
  clock.advance(300);
  pacer.resume();
  assert.deepEqual(got, [1, 2]);
});

test('지금으로: 쌓인 것을 쉬지 않고 모두 넘기고 멈춤이 풀린다', () => {
  const { clock, got, pacer } = setup();
  pacer.pause();
  for (const s of [1, 2, 3, 4]) pacer.push(msg(s));
  pacer.flush();
  assert.deepEqual(got, [1, 2, 3, 4]);
  assert.equal(pacer.queued(), 0);
  pacer.push(msg(5));
  assert.deepEqual(got, [1, 2, 3, 4, 5]);
  clock.advance(0);
});

test('멈춘 채로 시작할 수 있다(다시 붙어도 일시정지 유지)', () => {
  const { clock, got, pacer } = setup({ paused: true });
  pacer.push(msg(1));
  clock.advance(3000);
  assert.deepEqual(got, []);
  pacer.resume();
  assert.deepEqual(got, [1]);
});

test('멈춰 있어도 사람 확인이 오면 거기까지 바로 넘기고 멈춤을 풀고 알린다', () => {
  const { got, pacer, woke } = setup({ paused: true });
  pacer.push(msg(1));
  pacer.push(msg(2));
  pacer.push(msg(3, 'review.requested'));
  assert.deepEqual(got, [1, 2, 3]);
  assert.equal(woke(), 1);
  pacer.push(msg(4));
  assert.deepEqual(got, [1, 2, 3, 4]);
});

test('ping은 멈춰 있어도 바로 넘긴다(무소식 감시용)', () => {
  const { got, pacer } = setup({ paused: true });
  const delivered: string[] = [];
  const p2 = createEventPacer({ clock: fakeClock(), deliver: (t) => delivered.push(t), delayAfter: () => 0, paused: true });
  p2.push(JSON.stringify({ type: 'ping' }));
  assert.equal(delivered.length, 1);
  assert.deepEqual(got, []);
  pacer.dispose();
});

test('dispose 뒤 멈춤·계속·지금으로는 아무 일도 하지 않는다', () => {
  const { got, pacer } = setup({ paused: true });
  pacer.push(msg(1));
  pacer.dispose();
  pacer.resume();
  pacer.flush();
  pacer.pause();
  assert.deepEqual(got, []);
});

test('wakesPause: 사람 확인 요청과 회의 끝(합의)만', () => {
  const ev = (type: string) => parseEvent(msg(1, type))!;
  assert.equal(wakesPause(ev('review.requested')), true);
  assert.equal(wakesPause(ev('agent.message')), false);
  assert.equal(wakesPause({ type: 'meeting.agreed', tripId: 't', seq: 1, at: 'x', data: {} } as never), true);
});
