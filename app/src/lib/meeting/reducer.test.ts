import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyEvent,
  confirmSummary,
  initialMeetingState,
  latestRoute,
  researchDone,
  yesCount,
} from './reducer.ts';
import type { AgentInfo, MeetingEvent, MeetingState, PlaceInfo, ServerEvent } from './types.ts';

const agents: AgentInfo[] = [
  { agentId: 'agt_01', memberId: 'mem_01', nickname: '민수', title: 't1', chips: [], color: '#F97316' },
  { agentId: 'agt_02', memberId: 'mem_02', nickname: '지은', title: 't2', chips: [], color: '#EC4899' },
];

type Data<T extends MeetingEvent['type']> = Extract<MeetingEvent, { type: T }>['data'];

// seq를 1부터 자동으로 올리는 이벤트 도우미
function maker(): <T extends MeetingEvent['type']>(type: T, data: Data<T>) => Extract<MeetingEvent, { type: T }> {
  let seq = 0;
  return (type, data) =>
    ({ type, tripId: 'trp_1', seq: ++seq, at: '2026-10-24T14:00:00+09:00', data }) as never;
}

function run(events: ServerEvent[], from: MeetingState = initialMeetingState()): MeetingState {
  return events.reduce((state, event) => applyEvent(state, event).state, from);
}

const route = [{ day: 1, stops: [{ itemId: 'i1', name: '자갈치시장', lat: 35.0967, lng: 129.0305 }] }];
const place: PlaceInfo = {
  name: '자갈치시장',
  openHours: null,
  popularity: 80,
  crowd: 60,
  links: { kakaoMap: 'k', naverMap: 'n' },
};
const board = {
  candidates: [
    {
      placeId: 'plc_01',
      name: '돼지국밥',
      lat: 35.1,
      lng: 129.0,
      proposedBy: ['agt_01'],
      reactions: [{ agentId: 'agt_02', kind: 'like' as const, reason: '맛집' }],
    },
  ],
  agenda: [{ placeId: 'plc_01', text: '점심' }],
};

function started(ev: ReturnType<typeof maker>, kind: 'meeting' | 'renegotiation' = 'meeting') {
  return ev('meeting.started', { meetingId: 'mtg_01', kind, maxRounds: 3, agents });
}

function agreedData(planId: string) {
  return { planId, round: 1, durationSec: 1, proposalCount: 1, editCount: 0, satisfaction: [], concessions: [] };
}

test('meeting.started: 일반 회의는 이전 research·board·plans·latestPlanId를 모두 초기화', () => {
  const ev = maker();
  const before = run([
    started(ev),
    ev('research.progress', { agentId: 'agt_01', stage: 'done', foundCount: 3 }),
    ev('board.updated', board),
    ev('plan.proposed', { planId: 'p1', version: 1, route }),
    ev('vote.cast', { planId: 'p1', agentId: 'agt_01', vote: 'yes', score: 8 }),
    ev('meeting.agreed', agreedData('p1')),
  ]);
  assert.equal(before.latestPlanId, 'p1');
  assert.equal(before.research.agt_01?.stage, 'done');

  const state = run([ev('meeting.started', { meetingId: 'mtg_02', kind: 'meeting', maxRounds: 2, agents })], before);
  assert.equal(state.phase, 'researching');
  assert.equal(state.meetingId, 'mtg_02');
  assert.equal(state.kind, 'meeting');
  assert.equal(state.maxRounds, 2);
  assert.equal(state.round, 0);
  assert.deepEqual(state.research, {
    agt_01: { stage: 'planning', tool: null, focus: null, foundCount: 0 },
    agt_02: { stage: 'planning', tool: null, focus: null, foundCount: 0 },
  });
  assert.deepEqual(state.board, { candidates: [], agenda: [] });
  assert.deepEqual(state.plans, {});
  assert.equal(state.latestPlanId, null);
  assert.deepEqual(state.votes, {});
  assert.equal(state.agreement, null);
  assert.deepEqual(state.timeline, []);
  assert.equal(state.confirmedPlanId, null);
});

test('meeting.started: 재협상은 research·board·plans·latestPlanId 유지, 나머지는 초기화', () => {
  const ev = maker();
  const before = run([
    started(ev),
    ev('research.progress', { agentId: 'agt_01', stage: 'done', foundCount: 3 }),
    ev('board.updated', board),
    ev('plan.proposed', { planId: 'p1', version: 1, route }),
    ev('vote.cast', { planId: 'p1', agentId: 'agt_01', vote: 'yes', score: 8 }),
    ev('meeting.agreed', agreedData('p1')),
  ]);
  const after = run([ev('meeting.started', { meetingId: 'mtg_02', kind: 'renegotiation', maxRounds: 2, agents })], before);
  assert.equal(after.phase, 'researching');
  assert.equal(after.kind, 'renegotiation');
  assert.equal(after.maxRounds, 2);
  assert.deepEqual(after.research, before.research);
  assert.deepEqual(after.board, board);
  assert.deepEqual(after.plans, before.plans);
  assert.equal(after.latestPlanId, 'p1');
  assert.deepEqual(after.votes, {});
  assert.equal(after.agreement, null);
  assert.deepEqual(after.timeline, []);
  assert.equal(after.confirmedPlanId, null);
});

test('research.progress: AI별 갱신, tool·focus 없으면 null, 모르는 agentId는 무시', () => {
  const ev = maker();
  const focus = { lat: 35.1, lng: 129.0, label: '부산' };
  const state = run([
    started(ev),
    ev('research.progress', { agentId: 'agt_01', stage: 'searching', tool: 'crowd', focus, foundCount: 4 }),
    ev('research.progress', { agentId: 'agt_02', stage: 'picking', foundCount: 2 }),
    ev('research.progress', { agentId: 'agt_99', stage: 'done', foundCount: 9 }),
  ]);
  assert.deepEqual(state.research.agt_01, { stage: 'searching', tool: 'crowd', focus, foundCount: 4 });
  assert.deepEqual(state.research.agt_02, { stage: 'picking', tool: null, focus: null, foundCount: 2 });
  assert.equal(state.research.agt_99, undefined);
  assert.equal(state.lastSeq, 4);
});

test('board.updated: board를 통째로 교체', () => {
  const ev = maker();
  const state = run([started(ev), ev('board.updated', board), ev('board.updated', { candidates: [], agenda: [] })]);
  assert.deepEqual(state.board, { candidates: [], agenda: [] });
  assert.deepEqual(run([ev('board.updated', board)], state).board, board);
});

test('place.checked: 같은 agentId의 가장 최근 message에 붙고, 없으면 변화 없음', () => {
  const ev = maker();
  const state = run([
    started(ev),
    ev('round.started', { round: 1, maxRounds: 3 }),
    ev('agent.message', { agentId: 'agt_01', round: 1, text: 'a' }),
    ev('agent.message', { agentId: 'agt_02', round: 1, text: 'b' }),
    ev('agent.message', { agentId: 'agt_01', round: 1, text: 'c' }),
    ev('place.checked', { agentId: 'agt_01', place }),
  ]);
  assert.equal(state.phase, 'meeting');
  const places = state.timeline.map((t) => (t.kind === 'message' ? t.places.length : -1));
  assert.deepEqual(places, [-1, 0, 0, 1]);

  const ev2 = maker();
  const base = run([started(ev2)]);
  const orphan = run([ev2('place.checked', { agentId: 'agt_02', place: { ...place, name: 'x' } })], base);
  assert.deepEqual(orphan.timeline, []);
  assert.deepEqual(orphan.timeline, base.timeline);
  assert.equal(orphan.lastSeq, 2);
});

test('plan.proposed: plans·latestPlanId 저장, timeline proposal에는 route 없음', () => {
  const ev = maker();
  const state = run([
    started(ev),
    ev('plan.proposed', { planId: 'p1', version: 1, route }),
    ev('plan.proposed', { planId: 'p2', version: 2, route: [] }),
  ]);
  assert.deepEqual(state.plans.p1, { version: 1, route });
  assert.equal(state.latestPlanId, 'p2');
  const proposal = state.timeline[0];
  assert.ok(proposal?.kind === 'proposal');
  assert.equal(proposal.planId, 'p1');
  assert.equal(proposal.version, 1);
  assert.equal('route' in proposal, false);
});

test('vote.cast: planId·agentId별 저장', () => {
  const ev = maker();
  const state = run([
    started(ev),
    ev('vote.cast', { planId: 'p1', agentId: 'agt_01', vote: 'yes', score: 8 }),
    ev('vote.cast', { planId: 'p1', agentId: 'agt_02', vote: 'no', score: 4.5 }),
  ]);
  assert.deepEqual(state.votes, { p1: { agt_01: { vote: 'yes', score: 8 }, agt_02: { vote: 'no', score: 4.5 } } });
});

test('meeting.agreed·meeting.failed: phase와 값 저장', () => {
  const ev = maker();
  const agreed = run([started(ev), ev('meeting.agreed', agreedData('p1'))]);
  assert.equal(agreed.phase, 'agreed');
  assert.equal(agreed.agreement?.planId, 'p1');

  const ev2 = maker();
  const failed = run([started(ev2), ev2('meeting.failed', { reason: 'max_rounds', planId: 'p1' })]);
  assert.equal(failed.phase, 'failed');
  assert.deepEqual(failed.failure, { reason: 'max_rounds', planId: 'p1' });
});

test('confirm.requested: agreed와 failed(planId 있음)에서만 confirming, 그 외는 무시', () => {
  const confirmFrom = (events: (ev: ReturnType<typeof maker>) => MeetingEvent[]) => {
    const ev = maker();
    const state = run([started(ev), ...events(ev)]);
    return run([ev('confirm.requested', { planId: 'p1', version: 1 })], state);
  };
  const agreed = confirmFrom((ev) => [ev('meeting.agreed', agreedData('p1'))]);
  assert.equal(agreed.phase, 'confirming');
  assert.deepEqual(agreed.confirmVotes, { mem_01: 'pending', mem_02: 'pending' });

  const failedWithPlan = confirmFrom((ev) => [ev('meeting.failed', { reason: 'max_rounds', planId: 'p1' })]);
  assert.equal(failedWithPlan.phase, 'confirming');

  const failedNoPlan = confirmFrom((ev) => [ev('meeting.failed', { reason: 'error', planId: null })]);
  assert.equal(failedNoPlan.phase, 'failed');
  assert.deepEqual(failedNoPlan.confirmVotes, {});
  assert.equal(failedNoPlan.lastSeq, 3);

  assert.equal(confirmFrom(() => []).phase, 'researching');
});

test('confirm.cast: confirming에서만 반영', () => {
  const ev = maker();
  const early = run([started(ev), ev('confirm.cast', { planId: 'p1', memberId: 'mem_01', decision: 'approve' })]);
  assert.deepEqual(early.confirmVotes, {});
  const state = run([
    ev('meeting.agreed', agreedData('p1')),
    ev('confirm.requested', { planId: 'p1', version: 1 }),
    ev('confirm.cast', { planId: 'p1', memberId: 'mem_01', decision: 'approve' }),
    ev('confirm.cast', { planId: 'p1', memberId: 'mem_02', decision: 'revise' }),
  ], early);
  assert.deepEqual(state.confirmVotes, { mem_01: 'approve', mem_02: 'revise' });
});

test('plan.confirmed 이후에는 모든 이벤트 무시', () => {
  const ev = maker();
  const state = run([started(ev), ev('plan.confirmed', { planId: 'p1' })]);
  assert.equal(state.phase, 'confirmed');
  assert.equal(state.confirmedPlanId, 'p1');
  const after = applyEvent(state, ev('round.started', { round: 1, maxRounds: 3 }));
  assert.equal(after.gap, false);
  assert.equal(after.state, state);
});

test('seq: 중복은 무시, 건너뛰면 gap과 afterSeq, ping은 무시', () => {
  const ev = maker();
  const first = started(ev);
  const state = run([first]);
  const dup = applyEvent(state, first);
  assert.deepEqual(dup, { state, gap: false });

  ev('round.started', { round: 1, maxRounds: 3 });
  const skipped = applyEvent(state, ev('round.started', { round: 2, maxRounds: 3 }));
  assert.equal(skipped.gap, true);
  assert.equal(skipped.gap && skipped.afterSeq, 1);
  assert.equal(skipped.state, state);

  const ping = applyEvent(state, { type: 'ping' });
  assert.deepEqual(ping, { state, gap: false });
});

test('선택 함수: latestRoute', () => {
  const ev = maker();
  assert.deepEqual(latestRoute(initialMeetingState()), []);
  assert.deepEqual(latestRoute(run([started(ev), ev('plan.proposed', { planId: 'p1', version: 1, route })])), route);
});

test('선택 함수: yesCount', () => {
  const ev = maker();
  const state = run([
    started(ev),
    ev('vote.cast', { planId: 'p1', agentId: 'agt_01', vote: 'yes', score: 8 }),
    ev('vote.cast', { planId: 'p1', agentId: 'agt_02', vote: 'no', score: 4 }),
    ev('vote.cast', { planId: 'p2', agentId: 'agt_02', vote: 'yes', score: 8 }),
  ]);
  assert.equal(yesCount(state, 'p1'), 1);
  assert.equal(yesCount(state, 'p2'), 1);
  assert.equal(yesCount(state, 'nope'), 0);
});

test('선택 함수: confirmSummary', () => {
  const ev = maker();
  const state = run([
    started(ev),
    ev('meeting.agreed', agreedData('p1')),
    ev('confirm.requested', { planId: 'p1', version: 1 }),
    ev('confirm.cast', { planId: 'p1', memberId: 'mem_01', decision: 'approve' }),
  ]);
  assert.deepEqual(confirmSummary(state), { approve: 1, revise: 0, reject: 0, pending: 1 });
  assert.deepEqual(confirmSummary(initialMeetingState()), { approve: 0, revise: 0, reject: 0, pending: 0 });
});

test('선택 함수: researchDone', () => {
  const ev = maker();
  assert.equal(researchDone(initialMeetingState()), false);
  const one = run([started(ev), ev('research.progress', { agentId: 'agt_01', stage: 'done', foundCount: 1 })]);
  assert.equal(researchDone(one), false);
  const both = run([ev('research.progress', { agentId: 'agt_02', stage: 'done', foundCount: 2 })], one);
  assert.equal(researchDone(both), true);
});
