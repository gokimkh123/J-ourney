import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEvent, initialMeetingState, yesCount } from './reducer.ts';
import type { MeetingState, ServerEvent } from './types.ts';

// 명세 v2.2: round.started.speakers · vote.cast.carried · plan.proposed.changes(같은 planId에 version + 1)

let seq = 0;
const ev = (type: string, data: Record<string, unknown>): ServerEvent =>
  ({ type, tripId: 't', seq: ++seq, at: 'x', data }) as unknown as ServerEvent;

function run(events: ServerEvent[]): MeetingState {
  return events.reduce((state, event) => applyEvent(state, event).state, initialMeetingState());
}

const started = () =>
  ev('meeting.started', {
    meetingId: 'mtg_01', kind: 'meeting', maxRounds: 5,
    agents: [
      { agentId: 'agt_01', memberId: 'mem_01', nickname: '하준', title: 't', color: '#111111', chips: [] },
      { agentId: 'agt_02', memberId: 'mem_02', nickname: '서연', title: 't', color: '#222222', chips: [] },
    ],
  });

const route = [{ day: 1, stops: [] }];

test('round.started: speakers를 라운드 타임라인에 담는다. 없으면 칸을 만들지 않는다', () => {
  seq = 0;
  const state = run([
    started(),
    ev('round.started', { round: 1, maxRounds: 5, speakers: ['agt_01', 'agt_02'] }),
    ev('round.started', { round: 2, maxRounds: 5 }),
  ]);
  const rounds = state.timeline.filter((t) => t.kind === 'round');
  assert.deepEqual(rounds.map((r) => (r.kind === 'round' ? r.speakers : null)), [['agt_01', 'agt_02'], undefined]);
  assert.ok(!('speakers' in rounds[1]));
});

test('round.started: speakers에 글자가 아닌 값이 섞이면 버린다', () => {
  seq = 0;
  const state = run([started(), ev('round.started', { round: 2, maxRounds: 5, speakers: ['agt_02', 3, null] })]);
  const round = state.timeline.find((t) => t.kind === 'round');
  assert.deepEqual(round?.kind === 'round' ? round.speakers : null, ['agt_02']);
});

test('plan.proposed: 같은 planId의 새 version은 안을 덮어쓰고 changes를 타임라인에 담는다', () => {
  seq = 0;
  const state = run([
    started(),
    ev('plan.proposed', { planId: 'pln_A', version: 1, route, label: 'A' }),
    ev('plan.proposed', { planId: 'pln_B', version: 1, route, label: 'B' }),
    ev('plan.proposed', { planId: 'pln_A', version: 2, route, label: 'A', changes: ['1일째 광안리해수욕장 뺌 → 해운대해수욕장'] }),
  ]);
  assert.deepEqual(Object.keys(state.plans).sort(), ['pln_A', 'pln_B']);
  assert.equal(state.plans.pln_A.version, 2);
  const proposals = state.timeline.filter((t) => t.kind === 'proposal');
  assert.equal(proposals.length, 3);
  assert.ok(!('changes' in proposals[0]));
  assert.deepEqual(proposals[2].kind === 'proposal' ? proposals[2].changes : null, ['1일째 광안리해수욕장 뺌 → 해운대해수욕장']);
});

test('vote.cast: carried를 담고, 같은 AI가 같은 안에 다시 보내면 마지막 것을 쓴다', () => {
  seq = 0;
  const state = run([
    started(),
    ev('vote.cast', { planId: 'pln_A', agentId: 'agt_01', vote: 'yes', score: 8 }),
    ev('vote.cast', { planId: 'pln_A', agentId: 'agt_02', vote: 'yes', score: 7, carried: true }),
    ev('vote.cast', { planId: 'pln_A', agentId: 'agt_01', vote: 'no', score: 5 }),
  ]);
  assert.deepEqual(state.votes.pln_A, {
    agt_01: { vote: 'no', score: 5 },
    agt_02: { vote: 'yes', score: 7, carried: true },
  });
  assert.equal(yesCount(state, 'pln_A'), 1);
});

test('vote.cast: carried가 false거나 없으면 칸을 만들지 않는다', () => {
  seq = 0;
  const state = run([started(), ev('vote.cast', { planId: 'pln_A', agentId: 'agt_01', vote: 'yes', score: 8, carried: false })]);
  assert.ok(!('carried' in state.votes.pln_A.agt_01));
});
