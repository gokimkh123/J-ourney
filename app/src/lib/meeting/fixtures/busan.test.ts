import test from 'node:test';
import assert from 'node:assert/strict';

import { busanAgents, busanEvents } from './busan.ts';
import { applyEvent, initialMeetingState } from '../reducer.ts';
import type { MeetingEvent } from '../types.ts';

function of<T extends MeetingEvent['type']>(type: T) {
  return busanEvents.filter((e): e is Extract<MeetingEvent, { type: T }> => e.type === type);
}

function must<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}

const renegotiationIndex = busanEvents.findIndex(
  (e) => e.type === 'meeting.started' && e.data.kind === 'renegotiation',
);

test('seq는 1부터 빈틈없이 연속, tripId 일치', () => {
  assert.deepEqual(
    busanEvents.map((e) => e.seq),
    busanEvents.map((_, i) => i + 1),
  );
  assert.ok(busanEvents.every((e) => e.tripId === 'trp_8f3k2'));
});

test('at은 +09:00이고 시간순', () => {
  assert.ok(busanEvents.every((e) => e.at.endsWith('+09:00')));
  const times = busanEvents.map((e) => Date.parse(e.at));
  assert.ok(times.every((t, i) => !Number.isNaN(t) && (i === 0 || t > must(times[i - 1]))));
});

test('첫/마지막 이벤트와 에이전트 구성', () => {
  const first = must(busanEvents[0]);
  assert.equal(first.type, 'meeting.started');
  if (first.type !== 'meeting.started') return;
  assert.equal(first.data.kind, 'meeting');
  assert.equal(first.data.maxRounds, 3);
  assert.deepEqual(first.data.agents, busanAgents);
  assert.deepEqual(
    busanAgents.map((a) => [a.agentId, a.memberId, a.nickname, a.title, a.color, a.chips.map((c) => `${c.emoji}${c.label}`)]),
    [
      ['agt_01', 'mem_01', '민수', '민수의 일정 총괄 AI', '#F97316', ['📋계획형', '🏃부지런형']],
      ['agt_02', 'mem_02', '지은', '지은의 감성 탐험 AI', '#EC4899', ['🎉활기형', '🧭탐험형']],
      ['agt_03', 'mem_03', '현우', '현우의 동선 관리 AI', '#0EA5E9', ['📋계획형', '🐷절약형']],
      ['agt_04', 'mem_04', '서연', '서연의 여유 휴식 AI', '#10B981', ['🐢느긋형', '🌿한적형', '😴늦잠형']],
    ],
  );
  assert.ok(busanAgents.every((a) => !('mbti' in a)));
  const last = must(busanEvents[busanEvents.length - 1]);
  assert.equal(last.type, 'plan.confirmed');
  assert.deepEqual(last.data, { planId: 'pln_04' });
});

test('AI마다 research 4단계 순서, searching에는 tool과 focus', () => {
  for (const agent of busanAgents) {
    const rows = of('research.progress').filter((e) => e.data.agentId === agent.agentId);
    assert.deepEqual(
      rows.map((e) => e.data.stage),
      ['planning', 'searching', 'picking', 'done'],
    );
    const searching = must(rows[1]);
    assert.ok(searching.data.tool);
    assert.equal(typeof searching.data.focus?.label, 'string');
    assert.ok(must(rows[3]).data.foundCount > 0);
  }
});

test('조사 중 board.updated: 후보가 하나씩 늘어난다(핀이 하나씩 꽂힘), 반응은 아직 없다', () => {
  const boards = of('board.updated');
  const partials = boards.slice(0, 12);
  assert.deepEqual(
    partials.map((b) => b.data.candidates.length),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  for (const b of partials) assert.ok(b.data.candidates.every((c) => c.reactions.length === 0));
  // 앞 보드의 후보는 다음 보드에 그대로 이어진다.
  for (let i = 1; i < partials.length; i += 1) {
    const before = must(partials[i - 1]).data.candidates.map((c) => c.placeId);
    const after = must(partials[i]).data.candidates.map((c) => c.placeId);
    assert.ok(before.every((id) => after.includes(id)));
  }
  // 조사 끝(done)은 후보가 다 올라온 뒤에 온다.
  const firstDone = busanEvents.findIndex((e) => e.type === 'research.progress' && e.data.stage === 'done');
  assert.ok(firstDone > busanEvents.indexOf(must(partials[11])));
});

test('board.updated: 후보 12개 좌표(부산 전역)와 첫 반응, 조사 뒤 첫 완성 보드', () => {
  const boards = of('board.updated');
  assert.ok(boards.length >= 15);
  const firstBoard = must(boards[12]);
  assert.deepEqual(
    firstBoard.data.candidates.map((c) => [c.placeId, c.name, c.lat, c.lng]),
    [
      ['plc_01', '국제시장·깡통시장', 35.1007, 129.0285],
      ['plc_02', '자갈치시장', 35.0967, 129.0305],
      ['plc_03', '광안리 해변과 야경', 35.1532, 129.1186],
      ['plc_04', '흰여울문화마을', 35.0786, 129.0446],
      ['plc_05', '청사포 다릿돌전망대', 35.1595, 129.192],
      ['plc_06', '해운대 해수욕장', 35.1587, 129.1604],
      ['plc_07', '다대포 꿈의낙조분수', 35.0472, 128.9658],
      ['plc_08', '감천문화마을', 35.0975, 129.0106],
      ['plc_09', '대변항', 35.2263, 129.2272],
      ['plc_10', '해동용궁사', 35.1883, 129.2233],
      ['plc_11', '송도해상케이블카', 35.0763, 129.0176],
      ['plc_12', '범어사', 35.2823, 129.0679],
    ],
  );
  const reactions = firstBoard.data.candidates.flatMap((c) =>
    c.reactions.map((r) => [c.name, r.agentId, r.kind]),
  );
  assert.deepEqual(reactions, [
    ['국제시장·깡통시장', 'agt_03', 'like'],
    ['자갈치시장', 'agt_03', 'warn'],
    ['광안리 해변과 야경', 'agt_02', 'like'],
    ['흰여울문화마을', 'agt_04', 'like'],
    ['다대포 꿈의낙조분수', 'agt_01', 'block'],
  ]);
  const lastDone = busanEvents.findLastIndex((e) => e.type === 'research.progress');
  assert.equal(busanEvents.indexOf(firstBoard), lastDone + 1);
  const snapshots = new Set(boards.map((b) => JSON.stringify(b.data)));
  assert.equal(snapshots.size, boards.length);
});

test('라운드, 제안, 라운드별 투표 점수와 찬반', () => {
  const firstMeeting = busanEvents.slice(0, renegotiationIndex);
  assert.deepEqual(
    firstMeeting.flatMap((e) => (e.type === 'round.started' ? [e.data.round] : [])),
    [1, 2, 3],
  );
  const proposals = of('plan.proposed');
  assert.deepEqual(
    proposals.map((e) => [e.data.planId, e.data.version]),
    [['pln_01', 1], ['pln_02', 2], ['pln_03', 3], ['pln_04', 4]],
  );
  const candidates = must(of('board.updated')[12]).data.candidates;
  for (const proposal of proposals) {
    assert.equal(proposal.data.route.length, 2);
    for (const stop of proposal.data.route.flatMap((d) => d.stops)) {
      assert.ok(candidates.some((c) => c.name === stop.name && c.lat === stop.lat && c.lng === stop.lng));
    }
  }
  const votes = (planId: string) =>
    of('vote.cast')
      .filter((e) => e.data.planId === planId)
      .map((e) => [e.data.agentId, e.data.vote, e.data.score]);
  assert.deepEqual(votes('pln_01'), [['agt_01', 'yes', 8], ['agt_02', 'yes', 7], ['agt_03', 'no', 5], ['agt_04', 'no', 4]]);
  assert.deepEqual(votes('pln_02'), [['agt_01', 'yes', 8], ['agt_02', 'no', 5], ['agt_03', 'yes', 8], ['agt_04', 'yes', 7]]);
  assert.deepEqual(votes('pln_03'), [['agt_01', 'yes', 8], ['agt_02', 'yes', 8], ['agt_03', 'yes', 7], ['agt_04', 'yes', 9]]);
  assert.ok(votes('pln_03').every(([, , score]) => Number(score) >= 7));
  assert.deepEqual(votes('pln_04'), [['agt_01', 'yes', 8], ['agt_02', 'yes', 9], ['agt_03', 'yes', 8], ['agt_04', 'yes', 9]]);
});

test('place.checked 바로 앞에 같은 agentId의 message, 지도 링크', () => {
  const checks = of('place.checked');
  assert.ok(checks.length >= 3);
  for (const check of checks) {
    const prev = must(busanEvents[busanEvents.indexOf(check) - 1]);
    assert.equal(prev.type, 'agent.message');
    assert.equal(prev.data.agentId, check.data.agentId);
    assert.ok(check.data.place.links.kakaoMap.startsWith('https://'));
    assert.ok(check.data.place.links.naverMap.startsWith('https://'));
  }
});

test('합의 수치, 재협상 흐름, 확정 흐름', () => {
  const [agreed, reAgreed] = of('meeting.agreed');
  const first = must(agreed).data;
  assert.equal(first.planId, 'pln_03');
  assert.equal(first.round, 3);
  assert.equal(first.proposalCount, 3);
  assert.equal(first.satisfaction.length, 4);
  assert.ok(first.satisfaction.every((s) => s.score >= 7));
  assert.ok(first.concessions.length > 0);
  assert.ok(first.durationSec > 0 && first.editCount >= 0);
  assert.equal(must(reAgreed).data.planId, 'pln_04');

  const reStart = must(busanEvents[renegotiationIndex]);
  assert.ok(reStart.type === 'meeting.started' && reStart.data.maxRounds === 2);
  const after = busanEvents.slice(renegotiationIndex);
  const before = busanEvents.slice(0, renegotiationIndex);
  const newPlan = must(after.find((e) => e.type === 'plan.proposed'));
  assert.ok(newPlan.type === 'plan.proposed');
  assert.ok(!before.some((e) => e.type === 'plan.proposed' && e.data.planId === newPlan.data.planId));
  assert.ok(after.some((e) => e.type === 'round.started') && after.some((e) => e.type === 'agent.message'));

  assert.deepEqual(
    of('confirm.requested').map((e) => [e.data.planId, e.data.version]),
    [['pln_03', 3], ['pln_04', 4]],
  );
  assert.deepEqual(
    of('confirm.cast').map((e) => [e.data.planId, e.data.memberId, e.data.decision]),
    [
      ['pln_03', 'mem_01', 'approve'],
      ['pln_03', 'mem_02', 'approve'],
      ['pln_03', 'mem_03', 'approve'],
      ['pln_03', 'mem_04', 'revise'],
      ['pln_04', 'mem_01', 'approve'],
      ['pln_04', 'mem_02', 'approve'],
      ['pln_04', 'mem_03', 'approve'],
      ['pln_04', 'mem_04', 'approve'],
    ],
  );
});

test('reducer로 모두 적용하면 gap 없이 confirmed, 최종 planId pln_04', () => {
  let state = initialMeetingState();
  for (const event of busanEvents) {
    const result = applyEvent(state, event);
    assert.equal(result.gap, false);
    state = result.state;
  }
  assert.equal(state.lastSeq, must(busanEvents[busanEvents.length - 1]).seq);
  assert.equal(state.phase, 'confirmed');
  assert.equal(state.confirmedPlanId, 'pln_04');
});
