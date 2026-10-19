import test from 'node:test';
import assert from 'node:assert/strict';

import { busanEvents } from './busan.ts';
import type { MeetingEvent, PlanProposedEvent, VoteCastEvent } from '../types.ts';

function planProposed(version: number): PlanProposedEvent {
  const found = busanEvents.find(
    (e): e is PlanProposedEvent => e.type === 'plan.proposed' && e.data.version === version,
  );
  assert.ok(found, `plan.proposed v${version} 없음`);
  return found;
}

function votesFor(planId: string): VoteCastEvent[] {
  return busanEvents.filter(
    (e): e is VoteCastEvent => e.type === 'vote.cast' && e.data.planId === planId,
  );
}

test('busan: seq는 1부터 연속', () => {
  assert.deepEqual(
    busanEvents.map((e) => e.seq),
    busanEvents.map((_, i) => i + 1),
  );
});

test('busan: 모든 이벤트의 tripId 일치, ping 없음', () => {
  for (const e of busanEvents) assert.equal(e.tripId, 'trp_8f3k2');
  assert.equal(busanEvents.some((e) => (e.type as string) === 'ping'), false);
});

test('busan: at은 +09:00 ISO 시각이며 시간순', () => {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
  let prev = -Infinity;
  for (const e of busanEvents) {
    assert.match(e.at, pattern);
    const t = Date.parse(e.at);
    assert.ok(t >= prev, `seq ${e.seq} 시각 역전`);
    prev = t;
  }
});

test('busan: 첫·마지막 이벤트 type', () => {
  assert.equal(busanEvents[0]?.type, 'meeting.started');
  assert.equal(busanEvents.at(-1)?.type, 'plan.confirmed');
});

test('busan: 첫 meeting.started의 에이전트 구성', () => {
  const first = busanEvents[0] as Extract<MeetingEvent, { type: 'meeting.started' }>;
  assert.equal(first.data.kind, 'meeting');
  assert.equal(first.data.maxRounds, 3);
  assert.deepEqual(
    first.data.agents.map((a) => [a.agentId, a.memberId, a.nickname, a.mbti, a.color]),
    [
      ['agt_01', 'mem_01', '민수', 'ESTJ', '#F97316'],
      ['agt_02', 'mem_02', '지은', 'ENFP', '#EC4899'],
      ['agt_03', 'mem_03', '현우', 'ISTJ', '#0EA5E9'],
      ['agt_04', 'mem_04', '서연', 'ISFP', '#10B981'],
    ],
  );
});

test('busan: research.progress는 queries, search, summarize, done 순서', () => {
  const stages = busanEvents.flatMap((e) => (e.type === 'research.progress' ? [e.data.stage] : []));
  assert.deepEqual(stages, ['queries', 'search', 'summarize', 'done']);
});

test('busan: 라운드 1 투표 점수와 찬반', () => {
  const votes = votesFor(planProposed(1).data.planId);
  assert.deepEqual(
    votes.map((v) => [v.data.agentId, v.data.score]),
    [
      ['agt_01', 9.0],
      ['agt_02', 7.0],
      ['agt_03', 5.0],
      ['agt_04', 5.5],
    ],
  );
  assert.equal(votes.filter((v) => v.data.vote === 'yes').length, 2);
  assert.equal(votes.filter((v) => v.data.vote === 'no').length, 2);
  assert.deepEqual(
    votes.filter((v) => v.data.vote === 'yes').map((v) => v.data.score),
    [9.0, 7.0],
  );
});

test('busan: 라운드 3 전원 찬성', () => {
  const votes = votesFor(planProposed(3).data.planId);
  assert.equal(votes.length, 4);
  assert.ok(votes.every((v) => v.data.vote === 'yes'));
});

test('busan: plan.proposed planId는 v1~v4 모두 다름', () => {
  const ids = [1, 2, 3, 4].map((v) => planProposed(v).data.planId);
  assert.equal(new Set(ids).size, 4);
});

test('busan: place.checked 3개 이상, 앞에 같은 agentId의 agent.message 존재', () => {
  const checked = busanEvents.filter((e) => e.type === 'place.checked');
  assert.ok(checked.length >= 3);
  for (const e of checked) {
    if (e.type !== 'place.checked') continue;
    const hasMessage = busanEvents.some(
      (m) => m.type === 'agent.message' && m.seq < e.seq && m.data.agentId === e.data.agentId,
    );
    assert.ok(hasMessage, `seq ${e.seq} 앞에 agent.message 없음`);
  }
});

test('busan: 첫 회의의 라운드 1~3 각각에 place.checked 존재', () => {
  const end = busanEvents.findIndex((e, i) => i > 0 && e.type === 'meeting.started');
  assert.ok(end > 0, '재협상 meeting.started 없음');
  const segment = busanEvents.slice(0, end);
  for (const round of [1, 2, 3]) {
    const from = segment.findIndex((e) => e.type === 'round.started' && e.data.round === round);
    assert.ok(from >= 0, `라운드 ${round} round.started 없음`);
    const next = segment.findIndex((e, i) => i > from && e.type === 'round.started');
    const part = segment.slice(from, next === -1 ? segment.length : next);
    assert.ok(
      part.some((e) => e.type === 'place.checked'),
      `라운드 ${round}에 place.checked 없음`,
    );
  }
});

test('busan: 라운드별 round.started·agent.message 존재', () => {
  for (const round of [1, 2, 3]) {
    assert.ok(busanEvents.some((e) => e.type === 'round.started' && e.data.round === round));
    assert.ok(busanEvents.some((e) => e.type === 'agent.message' && e.data.round === round));
  }
});

test('busan: meeting.agreed 수치', () => {
  const agreed = busanEvents.find((e) => e.type === 'meeting.agreed');
  assert.ok(agreed && agreed.type === 'meeting.agreed');
  assert.equal(agreed.data.planId, planProposed(3).data.planId);
  assert.equal(agreed.data.round, 3);
  assert.equal(agreed.data.durationSec, 42);
  assert.ok(agreed.data.proposalCount > 0);
  assert.ok(agreed.data.editCount > 0);
  assert.deepEqual(agreed.data.satisfaction, [
    { memberId: 'mem_01', score: 8.5 },
    { memberId: 'mem_02', score: 8.0 },
    { memberId: 'mem_03', score: 9.0 },
    { memberId: 'mem_04', score: 7.5 },
  ]);
  assert.equal(agreed.data.concessions.length, 2);
});

test('busan: 재협상 흐름과 최종 확정 planId', () => {
  const starts = busanEvents.filter((e) => e.type === 'meeting.started');
  assert.equal(starts.length, 2);
  assert.ok(starts[1] && starts[1].type === 'meeting.started');
  assert.equal(starts[1].data.kind, 'renegotiation');

  const v4 = planProposed(4);
  const votes = votesFor(v4.data.planId);
  assert.equal(votes.length, 4);
  assert.ok(votes.every((v) => v.data.vote === 'yes'));

  const last = busanEvents.at(-1);
  assert.ok(last && last.type === 'plan.confirmed');
  assert.equal(last.data.planId, v4.data.planId);
});

test('busan: confirm.cast 결과', () => {
  const casts = busanEvents.filter((e) => e.type === 'confirm.cast');
  const v3Id = planProposed(3).data.planId;
  const v4Id = planProposed(4).data.planId;
  const decisions = (planId: string) =>
    casts.flatMap((e) => (e.type === 'confirm.cast' && e.data.planId === planId ? [e.data.decision] : []));
  assert.deepEqual(decisions(v3Id), ['approve', 'approve', 'approve', 'revise']);
  assert.deepEqual(decisions(v4Id), ['approve', 'approve', 'approve', 'approve']);
});
