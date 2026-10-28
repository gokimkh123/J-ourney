import test from 'node:test';
import assert from 'node:assert/strict';

import { busanEvents } from './fixtures/busan.ts';
import { eventDelayMs, eventsUntilFirstAgreed } from './player.ts';
import { createPlayback } from './playback.ts';
import type { Playback, PlaybackClock } from './playback.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import type { MeetingEvent, MeetingState } from './types.ts';

type Pending = { at: number; fn: () => void };

// 손으로 시간을 흘리는 가짜 시계: 예약 목록과 tick(ms)
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const clock: PlaybackClock = {
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

const FOREVER = 1e9;
const agreedEvents = eventsUntilFirstAgreed(busanEvents);
const json = (value: unknown) => JSON.stringify(value);

function reduceAll(events: MeetingEvent[]): MeetingState {
  return events.reduce((state, event) => applyEvent(state, event).state, initialMeetingState());
}

const finalJson = json(reduceAll(agreedEvents));

function makeEvent(seq: number): MeetingEvent {
  return {
    type: 'round.started',
    tripId: 'trp_8f3k2',
    seq,
    at: '2026-10-24T14:03:11+09:00',
    data: { round: seq, maxRounds: 3 },
  };
}

function setup(events: MeetingEvent[] = agreedEvents, delayFor?: (event: MeetingEvent) => number) {
  const fake = fakeClock();
  const clock = fake.clock;
  const playback = createPlayback(delayFor ? { events, clock, delayFor } : { events, clock });
  return { fake, playback };
}

function counter(playback: Playback): { n: number } {
  const calls = { n: 0 };
  playback.subscribe(() => {
    calls.n += 1;
  });
  return calls;
}

function assertFinished(playback: Playback, fake: ReturnType<typeof fakeClock>): void {
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(json(playback.getState()), finalJson);
  assert.equal(playback.getAppliedCount(), playback.getTotalCount());
  assert.equal(fake.pendingCount(), 0);
}

test('(a) start 직후 첫 이벤트만 적용, 직전 이벤트의 delayFor 가 지나야 다음', () => {
  const { fake, playback } = setup();
  assert.equal(playback.getStatus(), 'idle');
  assert.equal(json(playback.getState()), json(initialMeetingState()));
  playback.start();
  assert.equal(playback.getStatus(), 'playing');
  assert.equal(playback.getAppliedCount(), 1);
  assert.equal(playback.getState().lastSeq, 1);
  fake.tick(eventDelayMs(agreedEvents[0]!) - 1);
  assert.equal(playback.getAppliedCount(), 1);
  fake.tick(1);
  assert.equal(playback.getAppliedCount(), 2);
  assert.equal(fake.pendingCount(), 1);
});

test('(a) 사용자 delayFor: 직전에 적용한 이벤트 기준으로 기다리고 마지막엔 타이머 없음', () => {
  const { fake, playback } = setup([makeEvent(1), makeEvent(2), makeEvent(3)], (e) => e.seq * 100);
  playback.start();
  fake.tick(99);
  assert.equal(playback.getAppliedCount(), 1);
  fake.tick(1);
  assert.equal(playback.getAppliedCount(), 2);
  fake.tick(199);
  assert.equal(playback.getAppliedCount(), 2);
  fake.tick(1);
  assert.equal(playback.getAppliedCount(), 3);
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(fake.pendingCount(), 0);
});

test('(b) 첫 합의까지 끝까지 흘리면 finished, reducer 직접 적용 결과와 같다', () => {
  const { fake, playback } = setup();
  playback.start();
  fake.tick(FOREVER);
  assertFinished(playback, fake);
});

test('(c) pause 중엔 변하지 않고 resume 후 delayFor 전체 시간 뒤에 이어진다', () => {
  const { fake, playback } = setup();
  playback.start();
  fake.tick(eventDelayMs(agreedEvents[0]!));
  assert.equal(playback.getAppliedCount(), 2);
  playback.pause();
  assert.equal(playback.getStatus(), 'paused');
  assert.equal(fake.pendingCount(), 0);
  const before = json(playback.getState());
  fake.tick(10_000);
  assert.equal(json(playback.getState()), before);
  assert.equal(playback.getAppliedCount(), 2);
  playback.resume();
  assert.equal(playback.getStatus(), 'playing');
  const wait = eventDelayMs(agreedEvents[1]!);
  fake.tick(wait - 1);
  assert.equal(playback.getAppliedCount(), 2);
  fake.tick(1);
  assert.equal(playback.getAppliedCount(), 3);
  fake.tick(FOREVER);
  assertFinished(playback, fake);
});

test('(d) skipToEnd: idle·playing·paused 모두 같은 최종 상태, 구독자 한 번, 타이머 없음', () => {
  for (const mode of ['idle', 'playing', 'paused'] as const) {
    const { fake, playback } = setup();
    if (mode !== 'idle') {
      playback.start();
      fake.tick(3000);
    }
    if (mode === 'paused') playback.pause();
    assert.equal(playback.getStatus(), mode);
    const calls = counter(playback);
    playback.skipToEnd();
    assert.equal(calls.n, 1);
    assertFinished(playback, fake);
    playback.skipToEnd();
    fake.tick(FOREVER);
    assert.equal(calls.n, 1);
  }
});

test('(e) restart: 처음으로 돌아가 다시 시작하고 구독자는 유지된다', () => {
  const { fake, playback } = setup();
  playback.start();
  fake.tick(5000);
  const calls = counter(playback);
  playback.restart();
  assert.ok(calls.n > 0);
  assert.equal(playback.getStatus(), 'playing');
  assert.equal(playback.getAppliedCount(), 1);
  assert.equal(json(playback.getState()), json(reduceAll(agreedEvents.slice(0, 1))));
  assert.equal(fake.pendingCount(), 1);
  const afterRestart = calls.n;
  fake.tick(FOREVER);
  assertFinished(playback, fake);
  assert.ok(calls.n > afterRestart);
  playback.restart();
  assert.equal(playback.getStatus(), 'playing');
  assert.equal(playback.getAppliedCount(), 1);
});

test('(f) seq 가 비면 그 이벤트를 적용하지 않고 error 로 멈춘다', () => {
  const { fake, playback } = setup([makeEvent(1), makeEvent(2), makeEvent(4)], () => 100);
  playback.start();
  fake.tick(200);
  assert.equal(playback.getStatus(), 'error');
  assert.equal(playback.getAppliedCount(), 2);
  assert.equal(playback.getState().lastSeq, 2);
  assert.equal(fake.pendingCount(), 0);
  const before = json(playback.getState());
  fake.tick(FOREVER);
  playback.skipToEnd();
  assert.equal(json(playback.getState()), before);
  assert.equal(playback.getStatus(), 'error');
});

test('(g) 중복 seq 는 세지 않고 대기 없이 건너뛴다', () => {
  const { fake, playback } = setup([makeEvent(2), makeEvent(1), makeEvent(3), makeEvent(2)], () => 100);
  playback.start();
  fake.tick(100);
  assert.equal(playback.getAppliedCount(), 2);
  fake.tick(100);
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(playback.getAppliedCount(), 3);
  assert.equal(playback.getTotalCount(), 4);
  assert.equal(playback.getState().lastSeq, 3);
  assert.equal(fake.pendingCount(), 0);
});

test('(g) 마지막 유효 이벤트 뒤에 중복만 남으면 start 직후 finished', () => {
  const { fake, playback } = setup([makeEvent(1), makeEvent(1)], () => 100);
  playback.start();
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(playback.getAppliedCount(), 1);
  assert.equal(playback.getTotalCount(), 2);
  assert.equal(fake.pendingCount(), 0);
});

test('(g) 마지막 유효 이벤트를 적용한 시점에 뒤따르는 중복이 있어도 바로 finished', () => {
  const { fake, playback } = setup([makeEvent(1), makeEvent(2), makeEvent(2)], () => 100);
  playback.start();
  assert.equal(playback.getStatus(), 'playing');
  assert.equal(fake.pendingCount(), 1);
  fake.tick(99);
  assert.equal(playback.getAppliedCount(), 1);
  fake.tick(1);
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(playback.getAppliedCount(), 2);
  assert.equal(playback.getState().lastSeq, 2);
  assert.equal(fake.pendingCount(), 0);
});

test('(h) dispose 뒤에는 어떤 호출·남은 타이머도 상태를 바꾸지 않고 구독자도 안 불린다', () => {
  const { fake, playback } = setup();
  playback.start();
  fake.tick(2000);
  const calls = counter(playback);
  const stale = fake.pendingFns();
  assert.equal(stale.length, 1);
  const snapshot = () => ({
    state: json(playback.getState()),
    status: playback.getStatus(),
    applied: playback.getAppliedCount(),
  });
  const before = snapshot();
  playback.dispose();
  assert.equal(fake.pendingCount(), 0);
  const late = counter(playback);
  playback.start();
  playback.pause();
  playback.resume();
  playback.skipToEnd();
  playback.restart();
  for (const fn of stale) fn();
  fake.tick(FOREVER);
  assert.deepEqual(snapshot(), before);
  assert.equal(calls.n, 0);
  assert.equal(late.n, 0);
  assert.equal(fake.pendingCount(), 0);
});

test('(i) 구독자가 안에서 자신을 해제해도 다른 구독자는 정상 호출된다', () => {
  const { fake, playback } = setup();
  const calls = { self: 0, other: 0 };
  const off = playback.subscribe(() => {
    calls.self += 1;
    off();
  });
  playback.subscribe(() => {
    calls.other += 1;
  });
  playback.start();
  assert.deepEqual(calls, { self: 1, other: 1 });
  fake.tick(eventDelayMs(agreedEvents[0]!));
  assert.deepEqual(calls, { self: 1, other: 2 });
});

test('구독자 안에서 pause 를 불러도 타이머가 남지 않는다', () => {
  const { fake, playback } = setup();
  playback.subscribe(() => {
    if (playback.getAppliedCount() === 2) playback.pause();
  });
  playback.start();
  fake.tick(FOREVER);
  assert.equal(playback.getStatus(), 'paused');
  assert.equal(playback.getAppliedCount(), 2);
  assert.equal(fake.pendingCount(), 0);
});

test('(j) 이벤트 0개는 start 후 즉시 finished', () => {
  const { fake, playback } = setup([]);
  const calls = counter(playback);
  playback.start();
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(playback.getAppliedCount(), 0);
  assert.equal(playback.getTotalCount(), 0);
  assert.equal(fake.pendingCount(), 0);
  assert.equal(calls.n, 1);
});

test('(k) start 를 두 번 불러도 타이머가 중복되지 않는다', () => {
  const { fake, playback } = setup();
  playback.start();
  playback.start();
  assert.equal(fake.pendingCount(), 1);
  assert.equal(playback.getAppliedCount(), 1);
  fake.tick(FOREVER);
  assertFinished(playback, fake);
});

test('(l) 입력 events 배열이 바뀌지 않고 뒤섞인 입력도 seq 순서로 재생된다', () => {
  const input = [...agreedEvents].reverse();
  const snapshot = [...input];
  const { fake, playback } = setup(input);
  playback.start();
  fake.tick(FOREVER);
  assertFinished(playback, fake);
  assert.equal(input.length, snapshot.length);
  input.forEach((e, i) => assert.equal(e, snapshot[i]));
});

test('서버 합의안이 도착하기 전에는 건너뛰기를 막고, 도착하면 허용한다', () => {
  const fake = fakeClock();
  const playback = createPlayback({ events: agreedEvents, clock: fake.clock, serverAgreementDelayMs: 5000 });
  playback.start();
  assert.equal(playback.isAgreementReady(), false);
  assert.equal(playback.canSkip(), false);
  playback.skipToEnd();
  assert.equal(playback.getStatus(), 'playing');
  assert.ok(playback.getAppliedCount() < agreedEvents.length);
  fake.tick(5000);
  assert.equal(playback.isAgreementReady(), true);
  assert.equal(playback.canSkip(), true);
  playback.skipToEnd();
  assert.equal(playback.getStatus(), 'finished');
  assert.equal(json(playback.getState()), finalJson);
  playback.dispose();
});

test('일시정지해도 서버 시계는 흐르고, 재생이 합의까지 가면 합의안 도착으로 본다', () => {
  const fake = fakeClock();
  const slow = createPlayback({ events: agreedEvents, clock: fake.clock, serverAgreementDelayMs: 3000 });
  slow.start();
  slow.pause();
  fake.tick(3000);
  assert.equal(slow.isAgreementReady(), true);
  assert.equal(slow.canSkip(), true);
  slow.dispose();

  const late = createPlayback({ events: agreedEvents, clock: fake.clock, serverAgreementDelayMs: FOREVER });
  late.start();
  fake.tick(FOREVER / 10);
  assert.equal(late.getStatus(), 'finished');
  assert.equal(late.isAgreementReady(), true);
  late.dispose();
});

test('합의안을 한 번 받은 회의를 다시 보면 처음부터 건너뛸 수 있다', () => {
  const fake = fakeClock();
  const playback = createPlayback({ events: agreedEvents, clock: fake.clock, serverAgreementDelayMs: 2000 });
  playback.start();
  fake.tick(2000);
  playback.skipToEnd();
  playback.restart();
  assert.equal(playback.getStatus(), 'playing');
  assert.equal(playback.canSkip(), true);
  playback.dispose();
});

test('서버 합의 시각을 주지 않으면 예전처럼 언제든 건너뛸 수 있다', () => {
  const fake = fakeClock();
  const playback = createPlayback({ events: agreedEvents, clock: fake.clock });
  playback.start();
  assert.equal(playback.canSkip(), true);
  playback.skipToEnd();
  assert.equal(playback.getStatus(), 'finished');
  playback.dispose();
});
