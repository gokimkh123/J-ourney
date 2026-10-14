import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEvent, initialMeetingState } from './reducer.ts';
import { busanEvents } from './fixtures/busan.ts';
import type {
  MeetingEvent,
  MeetingPhase,
  MeetingStartedEvent,
  MeetingState,
  ServerEvent,
} from './types.ts';

const base = { tripId: 'trp_8f3k2', at: '2026-10-24T15:00:00+09:00' };
const agents = (busanEvents[0] as MeetingStartedEvent).data.agents;

function applyAll(events: readonly ServerEvent[], initial: MeetingState = initialMeetingState()): MeetingState {
  let state = initial;
  for (const event of events) state = applyEvent(state, event).state;
  return state;
}

function upTo(seq: number): MeetingState {
  return applyAll(busanEvents.filter((e) => e.seq <= seq));
}

function eventAt(seq: number): MeetingEvent {
  const found = busanEvents.find((e) => e.seq === seq);
  assert.ok(found, `seq ${seq} 이벤트 없음`);
  return found;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function messagePlaces(state: MeetingState): Map<number, string[]> {
  return new Map(
    state.timeline.flatMap((item) =>
      item.kind === 'message' ? [[item.seq, item.places.map((p) => p.name)] as const] : [],
    ),
  );
}

test('initialMeetingState: 초기값', () => {
  assert.deepEqual(initialMeetingState(), {
    lastSeq: 0,
    phase: 'idle',
    agents: [],
    research: {
      stage: null,
      counts: { queries: 0, places: 0, reviews: 0, tourism: 0 },
      highlights: [],
    },
    round: 0,
    maxRounds: 0,
    timeline: [],
    votes: {},
    agreement: null,
    failure: null,
    confirmVotes: {},
    confirmedPlanId: null,
  });
});

test('initialMeetingState: 호출마다 새 객체', () => {
  const a = initialMeetingState();
  const b = initialMeetingState();
  assert.notEqual(a, b);
  assert.notEqual(a.agents, b.agents);
  assert.notEqual(a.research, b.research);
  assert.notEqual(a.research.counts, b.research.counts);
  assert.notEqual(a.research.highlights, b.research.highlights);
  assert.notEqual(a.timeline, b.timeline);
  assert.notEqual(a.votes, b.votes);
  assert.notEqual(a.confirmVotes, b.confirmVotes);
});

test('busan 전체 적용: confirmed, 확정 planId, 마지막 seq', () => {
  let state = initialMeetingState();
  for (const event of busanEvents) {
    const result = applyEvent(state, event);
    assert.equal(result.gap, false, `seq ${event.seq}에서 gap`);
    assert.equal(result.state.lastSeq, event.seq);
    state = result.state;
  }
  assert.equal(state.phase, 'confirmed');
  assert.equal(state.confirmedPlanId, 'pln_busan_v4');
  assert.equal(state.lastSeq, busanEvents.at(-1)?.seq);
  assert.deepEqual(state.agents, agents);
  assert.deepEqual(state.confirmVotes, {
    mem_01: 'approve',
    mem_02: 'approve',
    mem_03: 'approve',
    mem_04: 'approve',
  });
});

test('busan 적용 중 researching, meeting, agreed, confirming 단계를 순서대로 거침', () => {
  const phases: MeetingPhase[] = [];
  let state = initialMeetingState();
  for (const event of busanEvents) {
    state = applyEvent(state, event).state;
    phases.push(state.phase);
  }
  const firstIndexes = (['researching', 'meeting', 'agreed', 'confirming', 'confirmed'] as const).map((p) =>
    phases.indexOf(p),
  );
  for (const index of firstIndexes) assert.ok(index >= 0);
  assert.deepEqual([...firstIndexes].sort((a, b) => a - b), firstIndexes);
});

test('research.progress는 자료조사 상태만 갱신하고 phase는 researching 유지', () => {
  for (const seq of [2, 3, 4, 5]) {
    const state = upTo(seq);
    const event = eventAt(seq);
    assert.ok(event.type === 'research.progress');
    assert.equal(state.phase, 'researching');
    assert.deepEqual(state.research, event.data);
  }
  assert.equal(upTo(5).research.stage, 'done');
});

test('place.checked: 같은 agentId의 직전 말풍선에 장소 카드가 붙음', () => {
  const state = upTo(41);
  assert.deepEqual(
    messagePlaces(state),
    new Map([
      [7, ['해운대 해변열차']],
      [9, ['감천문화마을']],
      [11, ['자갈치시장']],
      [13, []],
      [20, ['서면 비즈니스 호텔']],
      [22, []],
      [29, ['광안리 해수욕장']],
    ]),
  );

  const placeEvent = eventAt(8);
  assert.ok(placeEvent.type === 'place.checked');
  const message = state.timeline.find((item) => item.seq === 7);
  assert.ok(message && message.kind === 'message');
  assert.equal(message.agentId, 'agt_01');
  assert.deepEqual(message.places, [placeEvent.data.place]);

  const placeCount = busanEvents.filter((e) => e.type === 'place.checked' && e.seq <= 41).length;
  assert.equal(
    state.timeline.reduce((sum, item) => sum + (item.kind === 'message' ? item.places.length : 0), 0),
    placeCount,
  );
});

test('place.checked: 같은 agentId의 말풍선이 없으면 timeline 유지, lastSeq만 갱신', () => {
  const place = { name: '해동용궁사', openHours: '05:00-19:00', review: null, placeUrl: 'https://map.example.com/p/yonggung' };

  const noMessage = upTo(6);
  const result1 = applyEvent(noMessage, { ...base, type: 'place.checked', seq: 7, data: { agentId: 'agt_01', place } });
  assert.equal(result1.gap, false);
  assert.equal(result1.state.lastSeq, 7);
  assert.deepEqual(result1.state.timeline, noMessage.timeline);

  const otherAgentOnly = upTo(7);
  const result2 = applyEvent(otherAgentOnly, {
    ...base,
    type: 'place.checked',
    seq: 8,
    data: { agentId: 'agt_02', place },
  });
  assert.equal(result2.state.lastSeq, 8);
  assert.deepEqual(result2.state.timeline, otherAgentOnly.timeline);
});

test('timeline: 라운드 시작·말풍선·일정안 순서가 이벤트 순서와 일치', () => {
  const state = upTo(41);
  const kindOf = { 'round.started': 'round', 'agent.message': 'message', 'plan.proposed': 'proposal' } as const;
  const expected = busanEvents.flatMap((e) =>
    e.seq <= 41 && (e.type === 'round.started' || e.type === 'agent.message' || e.type === 'plan.proposed')
      ? [[kindOf[e.type], e.seq]]
      : [],
  );
  assert.deepEqual(
    state.timeline.map((item) => [item.kind, item.seq]),
    expected,
  );
  assert.deepEqual(
    state.timeline.slice(0, 7).map((item) => [item.kind, item.seq]),
    [
      ['round', 6],
      ['message', 7],
      ['message', 9],
      ['message', 11],
      ['message', 13],
      ['proposal', 14],
      ['round', 19],
    ],
  );
  assert.deepEqual(state.timeline[0], {
    kind: 'round',
    seq: 6,
    at: '2026-10-24T14:00:25+09:00',
    round: 1,
    maxRounds: 3,
  });
  assert.deepEqual(state.timeline[5], {
    kind: 'proposal',
    seq: 14,
    at: '2026-10-24T14:01:05+09:00',
    planId: 'pln_busan_v1',
    version: 1,
  });
  assert.equal(state.round, 3);
  assert.equal(state.maxRounds, 3);
});

test('재협상 meeting.started: timeline·votes·agreement 초기화, lastSeq·agents 유지', () => {
  const before = upTo(41);
  assert.ok(before.timeline.length > 0);
  assert.ok(Object.keys(before.votes).length > 0);
  assert.notEqual(before.agreement, null);

  const event = eventAt(42);
  assert.ok(event.type === 'meeting.started' && event.data.kind === 'renegotiation');
  const result = applyEvent(before, event);
  assert.equal(result.gap, false);
  const after = result.state;
  assert.equal(after.phase, 'researching');
  assert.equal(after.lastSeq, 42);
  assert.deepEqual(after.agents, before.agents);
  assert.deepEqual(after.timeline, []);
  assert.deepEqual(after.votes, {});
  assert.equal(after.agreement, null);
  assert.deepEqual(after.confirmVotes, {});
  assert.equal(after.confirmedPlanId, null);
  assert.equal(after.round, 0);
  assert.deepEqual(after.research, before.research);
});

test('중복 seq는 무시', () => {
  const state = upTo(30);
  for (const seq of [1, 9, 29, 30]) {
    const result = applyEvent(state, eventAt(seq));
    assert.equal(result.gap, false);
    assert.equal(result.state, state);
  }
  assert.equal(applyAll(busanEvents.filter((e) => e.seq <= 30), state), state);
});

test('seq 건너뜀: gap true, afterSeq는 lastSeq, 상태 불변', () => {
  const state = upTo(5);
  const snapshot = structuredClone(state);
  const result = applyEvent(state, eventAt(7));
  assert.deepEqual(result, { state, gap: true, afterSeq: 5 });
  assert.equal(result.state, state);
  assert.deepEqual(state, snapshot);

  const initial = initialMeetingState();
  assert.deepEqual(applyEvent(initial, eventAt(2)), { state: initial, gap: true, afterSeq: 0 });

  const resumed = applyEvent(state, eventAt(6));
  assert.equal(resumed.gap, false);
  assert.equal(resumed.state.lastSeq, 6);
});

test('ping은 무시하고 lastSeq 불변', () => {
  const state = upTo(10);
  const pings: ServerEvent[] = [{ type: 'ping' }, { type: 'ping', ...base, seq: 11 }, { type: 'ping', seq: 99 }];
  for (const ping of pings) {
    const result = applyEvent(state, ping);
    assert.equal(result.gap, false);
    assert.equal(result.state, state);
    assert.equal(result.state.lastSeq, 10);
  }
  assert.equal(applyEvent(state, eventAt(11)).state.lastSeq, 11);
});

test('confirmed 이후 이벤트는 상태를 바꾸지 않음', () => {
  const state = applyAll(busanEvents);
  assert.equal(state.phase, 'confirmed');
  const events: MeetingEvent[] = [
    { ...base, type: 'meeting.started', seq: 57, data: { meetingId: 'mtg_03', kind: 'renegotiation', maxRounds: 3, agents } },
    { ...base, type: 'confirm.cast', seq: 57, data: { planId: 'pln_busan_v4', memberId: 'mem_04', decision: 'reject' } },
    { ...base, type: 'meeting.failed', seq: 57, data: { reason: 'error', planId: null } },
    { ...base, type: 'plan.confirmed', seq: 60, data: { planId: 'pln_other' } },
  ];
  for (const event of events) {
    const result = applyEvent(state, event);
    assert.equal(result.gap, false);
    assert.equal(result.state, state);
  }
  assert.equal(state.lastSeq, 56);
  assert.equal(state.confirmedPlanId, 'pln_busan_v4');
});

test('deep freeze한 입력 state·event로 예외 없이 동작하고 원본 불변', () => {
  let state = deepFreeze(initialMeetingState());
  for (const original of busanEvents) {
    const event = deepFreeze(structuredClone(original));
    const before = structuredClone(state);
    const result = applyEvent(state, event);
    assert.deepEqual(state, before, `seq ${event.seq}에서 입력 state 변경`);
    assert.deepEqual(event, original, `seq ${event.seq}에서 입력 event 변경`);
    assert.notEqual(result.state, state);
    state = deepFreeze(result.state);
  }
  assert.equal(state.phase, 'confirmed');
});

test('confirm.requested는 pending 초기화, confirm.cast 반영', () => {
  const agreed = upTo(36);
  assert.equal(agreed.phase, 'agreed');
  assert.deepEqual(agreed.confirmVotes, {});

  const requested = upTo(37);
  assert.equal(requested.phase, 'confirming');
  assert.deepEqual(requested.confirmVotes, {
    mem_01: 'pending',
    mem_02: 'pending',
    mem_03: 'pending',
    mem_04: 'pending',
  });

  assert.deepEqual(upTo(39).confirmVotes, {
    mem_01: 'approve',
    mem_02: 'approve',
    mem_03: 'pending',
    mem_04: 'pending',
  });
  assert.deepEqual(upTo(41).confirmVotes, {
    mem_01: 'approve',
    mem_02: 'approve',
    mem_03: 'approve',
    mem_04: 'revise',
  });

  assert.deepEqual(upTo(51).confirmVotes, {
    mem_01: 'pending',
    mem_02: 'pending',
    mem_03: 'pending',
    mem_04: 'pending',
  });
});

test('confirm.requested는 agreed에서만, confirm.cast는 confirming에서만 반영', () => {
  const meeting = upTo(13);
  const requested = applyEvent(meeting, {
    ...base,
    type: 'confirm.requested',
    seq: 14,
    data: { planId: 'pln_busan_v1', version: 1 },
  }).state;
  assert.equal(requested.phase, 'meeting');
  assert.deepEqual(requested.confirmVotes, {});
  assert.equal(requested.lastSeq, 14);

  const agreed = upTo(36);
  const cast = applyEvent(agreed, {
    ...base,
    type: 'confirm.cast',
    seq: 37,
    data: { planId: 'pln_busan_v3', memberId: 'mem_01', decision: 'approve' },
  }).state;
  assert.equal(cast.phase, 'agreed');
  assert.deepEqual(cast.confirmVotes, {});
  assert.equal(cast.lastSeq, 37);
});

test('vote.cast는 planId → agentId 구조로 저장', () => {
  assert.deepEqual(upTo(18).votes, {
    pln_busan_v1: {
      agt_01: { vote: 'yes', score: 9.0 },
      agt_02: { vote: 'yes', score: 7.0 },
      agt_03: { vote: 'no', score: 5.0 },
      agt_04: { vote: 'no', score: 5.5 },
    },
  });
  const later = upTo(27);
  assert.deepEqual(Object.keys(later.votes), ['pln_busan_v1', 'pln_busan_v2']);
  assert.deepEqual(later.votes.pln_busan_v2?.agt_03, { vote: 'no', score: 6.0 });
});

test('meeting.agreed는 합의 결과를 저장', () => {
  const event = eventAt(36);
  assert.ok(event.type === 'meeting.agreed');
  const state = upTo(36);
  assert.equal(state.phase, 'agreed');
  assert.deepEqual(state.agreement, event.data);
});

test('meeting.failed 뒤 새 meeting.started 허용', () => {
  const failed = applyEvent(upTo(18), {
    ...base,
    type: 'meeting.failed',
    seq: 19,
    data: { reason: 'max_rounds', planId: 'pln_busan_v1' },
  }).state;
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.lastSeq, 19);
  assert.deepEqual(failed.failure, { reason: 'max_rounds', planId: 'pln_busan_v1' });

  const restarted = applyEvent(failed, {
    ...base,
    type: 'meeting.started',
    seq: 20,
    data: { meetingId: 'mtg_02', kind: 'meeting', maxRounds: 3, agents },
  });
  assert.equal(restarted.gap, false);
  const state = restarted.state;
  assert.equal(state.phase, 'researching');
  assert.equal(state.lastSeq, 20);
  assert.deepEqual(state.agents, agents);
  assert.deepEqual(state.timeline, []);
  assert.deepEqual(state.votes, {});
  assert.equal(state.agreement, null);
  assert.equal(state.failure, null);
  assert.equal(state.round, 0);
  assert.deepEqual(state.research, initialMeetingState().research);

  const round = applyEvent(state, { ...base, type: 'round.started', seq: 21, data: { round: 1, maxRounds: 3 } }).state;
  assert.equal(round.phase, 'meeting');
  assert.equal(round.round, 1);
});
