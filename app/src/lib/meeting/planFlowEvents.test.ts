import test from 'node:test';
import assert from 'node:assert/strict';

import { paceDelayMs } from './eventPacer.ts';
import { parseEvent } from './parse.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import type { MeetingState, ServerEvent } from './types.ts';

// 명세 v2.3: 회의가 끝난 뒤 오는 choice.cast · plan.chosen · confirm.closed

const raw = (seq: number, type: string, data: Record<string, unknown>) => JSON.stringify({ type, tripId: 't', seq, at: 'x', data });

function parsed(seq: number, type: string, data: Record<string, unknown>): ServerEvent {
  const event = parseEvent(raw(seq, type, data));
  assert.ok(event !== null, `${type}를 버리면 안 된다`);
  return event;
}

const agents = [
  { agentId: 'agt_01', memberId: 'mem_01', nickname: '하준', title: 't', color: '#111111', chips: [] },
  { agentId: 'agt_02', memberId: 'mem_02', nickname: '서연', title: 't', color: '#222222', chips: [] },
];

function run(events: ServerEvent[]) {
  let state: MeetingState = initialMeetingState();
  const gaps: number[] = [];
  for (const event of events) {
    const result = applyEvent(state, event);
    if (result.gap && event.type !== 'ping') gaps.push(event.seq);
    state = result.state;
  }
  return { state, gaps };
}

const agreedRun = () => [
  parsed(1, 'meeting.started', { meetingId: 'mtg_01', kind: 'meeting', maxRounds: 5, agents }),
  parsed(2, 'meeting.agreed', { meetingId: 'mtg_01', rounds: 2, durationSec: 60, proposalCount: 2, editCount: 0, plans: [] }),
  parsed(3, 'choice.cast', { memberId: 'mem_01', planId: 'pln_A', answered: 1, total: 2 }),
  parsed(4, 'choice.cast', { memberId: 'mem_02', planId: 'pln_A', answered: 2, total: 2 }),
  parsed(5, 'plan.chosen', { planId: 'pln_A', label: 'A', by: 'all', tie: false, votes: { A: 2, B: 0 }, version: 3 }),
];

test('세 이벤트를 파서가 받는다', () => {
  parsed(1, 'choice.cast', { memberId: 'm', planId: 'p', answered: 1, total: 2 });
  parsed(1, 'plan.chosen', { planId: 'p', label: 'A', by: 'host', tie: true, votes: { A: 1, B: 1 }, version: 1 });
  parsed(1, 'confirm.closed', { planId: 'p', version: 1, result: 'rejected', by: 'm' });
});

test('고르기 이벤트 뒤에 오는 이벤트가 seq 빈칸 없이 이어진다', () => {
  const { state, gaps } = run([...agreedRun(), parsed(6, 'confirm.requested', { planId: 'pln_A', version: 3 })]);
  assert.deepEqual(gaps, []);
  assert.equal(state.lastSeq, 6);
  assert.equal(state.phase, 'confirming');
});

test('confirm.closed(부결): 확정 투표 전(agreed)으로 돌아가고, 다시 확정 투표를 받을 수 있다', () => {
  const { state, gaps } = run([
    ...agreedRun(),
    parsed(6, 'confirm.requested', { planId: 'pln_A', version: 3 }),
    parsed(7, 'confirm.cast', { planId: 'pln_A', version: 3, memberId: 'mem_01', decision: 'reject', answered: 1, total: 2 }),
    parsed(8, 'confirm.closed', { planId: 'pln_A', version: 3, result: 'rejected', by: 'mem_01' }),
  ]);
  assert.deepEqual(gaps, []);
  assert.equal(state.phase, 'agreed');
  assert.deepEqual(state.confirmVotes, {});
  const again = applyEvent(state, parsed(9, 'confirm.requested', { planId: 'pln_A', version: 4 }));
  assert.equal(again.state.phase, 'confirming');
});

test('confirm.closed: 확정 투표 중이 아니면 아무것도 바꾸지 않는다(seq만 받음)', () => {
  const { state } = run([...agreedRun(), parsed(6, 'confirm.closed', { planId: 'pln_A', version: 3, result: 'rejected', by: 'mem_01' })]);
  assert.equal(state.phase, 'agreed');
  assert.equal(state.lastSeq, 6);
});

test('사람이 한 일(고르기·확정 투표)은 속도 조절기가 늦추지 않는다', () => {
  for (const event of [
    parsed(1, 'choice.cast', { memberId: 'm', planId: 'p', answered: 1, total: 2 }),
    parsed(1, 'plan.chosen', { planId: 'p', label: 'A', by: 'all', tie: false, votes: { A: 2, B: 0 }, version: 1 }),
    parsed(1, 'confirm.requested', { planId: 'p', version: 1 }),
    parsed(1, 'confirm.cast', { planId: 'p', version: 1, memberId: 'm', decision: 'approve', answered: 1, total: 2 }),
    parsed(1, 'confirm.closed', { planId: 'p', version: 1, result: 'rejected', by: 'm' }),
    parsed(1, 'plan.confirmed', { planId: 'p', version: 1 }),
  ]) {
    assert.equal(paceDelayMs(event), 0, event.type);
  }
});
