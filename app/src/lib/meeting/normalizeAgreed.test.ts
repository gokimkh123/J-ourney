import test from 'node:test';
import assert from 'node:assert/strict';

import { agreementView } from './view.ts';
import { normalizeServerEvent } from './normalize.ts';
import { parseEvent } from './parse.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import type { MeetingAgreedEvent, ServerEvent } from './types.ts';

const plan = (label: 'A' | 'B', average: number, extra: Record<string, unknown> = {}) => ({
  planId: `pln_${label}`,
  label,
  version: 1,
  title: `${label}안`,
  summary: '한 줄',
  source: 'llm',
  satisfaction: {
    average,
    passed: average >= 7,
    members: [
      { memberId: 'mem_01', agentId: 'agt_01', score: average, stance: 'support' },
      { memberId: 'mem_02', agentId: 'agt_02', score: average + 1, stance: 'support' },
    ],
  },
  concessions: [
    { memberId: 'mem_01', mustMissed: ['아침 늦게 시작'], warned: ['송도해상케이블카'] },
    { memberId: 'mem_02', mustMissed: [], warned: [] },
  ],
  ...extra,
});

const v23 = (data: Record<string, unknown>): ServerEvent =>
  ({ type: 'meeting.agreed', tripId: 't', seq: 9, at: 'x', data }) as unknown as ServerEvent;

const base = { meetingId: 'mtg_01', outcome: 'both_passed', rounds: 3, durationSec: 154, proposalCount: 5, editCount: 4 };

test('v2.3 두 안: 만족도 평균이 높은 안을 한 안짜리로 바꾼다', () => {
  const e = normalizeServerEvent(v23({ ...base, plans: [plan('A', 7), plan('B', 8)] })) as MeetingAgreedEvent;
  assert.equal(e.data.planId, 'pln_B');
  assert.equal(e.data.round, 3);
  assert.equal(e.data.durationSec, 154);
  assert.equal(e.data.proposalCount, 5);
  assert.equal(e.data.editCount, 4);
  assert.deepEqual(e.data.satisfaction, [
    { memberId: 'mem_01', score: 8 },
    { memberId: 'mem_02', score: 9 },
  ]);
});

test('평균이 같으면 앞의 안(A)', () => {
  const e = normalizeServerEvent(v23({ ...base, plans: [plan('A', 8), plan('B', 8)] })) as MeetingAgreedEvent;
  assert.equal(e.data.planId, 'pln_A');
});

test('양보는 못 지킨 것과 걸리는 곳을 gave에 담고 got은 비운다. 비어 있는 사람은 뺀다', () => {
  const e = normalizeServerEvent(v23({ ...base, plans: [plan('A', 8)] })) as MeetingAgreedEvent;
  assert.deepEqual(e.data.concessions, [{ memberId: 'mem_01', gave: '아침 늦게 시작, 송도해상케이블카', got: '' }]);
});

test('durationSec이 null이어도 숫자로 둔다', () => {
  const e = normalizeServerEvent(v23({ ...base, durationSec: null, plans: [plan('A', 8)] })) as MeetingAgreedEvent;
  assert.equal(e.data.durationSec, 0);
});

test('plans가 없거나 깨져도 던지지 않고 빈 합의로 만든다', () => {
  for (const data of [{}, { plans: 'x' }, { plans: [null, 3, { satisfaction: 'x', concessions: 'y' }] }]) {
    const e = normalizeServerEvent(v23(data)) as MeetingAgreedEvent;
    assert.deepEqual(e.data.satisfaction, []);
    assert.deepEqual(e.data.concessions, []);
  }
});

test('옛 모양(satisfaction·concessions 배열)은 받은 객체를 그대로 돌려준다', () => {
  const old = v23({ planId: 'p', round: 1, durationSec: 1, proposalCount: 1, editCount: 0, satisfaction: [], concessions: [] });
  assert.equal(normalizeServerEvent(old), old);
});

test('파서를 거쳐 reducer·agreementView까지 이어진다(합의안 화면 오류 방지)', () => {
  const started = parseEvent(
    JSON.stringify({
      type: 'meeting.started', tripId: 't', seq: 1, at: 'x',
      data: {
        meetingId: 'mtg_01', kind: 'meeting', maxRounds: 5,
        agents: [
          { agentId: 'agt_01', memberId: 'mem_01', nickname: '하준', title: 't', color: '#111111', chips: [] },
          { agentId: 'agt_02', memberId: 'mem_02', nickname: '서연', title: 't', color: '#222222', chips: [] },
        ],
      },
    }),
  )!;
  const agreed = parseEvent(JSON.stringify({ type: 'meeting.agreed', tripId: 't', seq: 2, at: 'x', data: { ...base, plans: [plan('A', 8)] } }))!;
  const state = [started, agreed].reduce((s, e) => applyEvent(s, e).state, initialMeetingState());
  assert.equal(state.phase, 'agreed');
  const view = agreementView(state);
  assert.ok(view !== null);
  assert.deepEqual(view.satisfaction.map((s) => s.score), [8, 9]);
  assert.equal(view.concessions.length, 1);
  assert.equal(view.concessions[0].got, '');
  assert.equal(view.stats[0].value, '2분 34초');
});
