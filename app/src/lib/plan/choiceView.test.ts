import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlanBoard, PlanCandidate, PlanChosen } from './board.ts';
import { boardPlans, choicePeople, choiceResult, choiceStage, demoChoices, myChoice } from './choiceView.ts';

const members = [
  { memberId: 'mem_1', name: '민수', color: '#111111' },
  { memberId: 'mem_2', name: '지은', color: '#222222' },
  { memberId: 'mem_3', name: '현우', color: '#333333' },
  { memberId: 'mem_4', name: '서연', color: '#444444' },
];

const candidate = (label: 'A' | 'B', title: string): PlanCandidate => ({
  planId: `pln_${label}`,
  label,
  version: 1,
  title,
  summary: '',
  satisfaction: { average: 7, passed: true, members: [] },
  concessions: [],
  plan: { planId: `pln_${label}`, version: 1, label, moveMode: 'transit', lodging: null, route: [{ day: 1, stops: [] }], notes: [`${label} 안내`], changes: [] },
});

function board(votes: [string, 'A' | 'B'][], chosen: PlanChosen | null = null, status: PlanBoard['status'] = 'choosing'): PlanBoard {
  return {
    status,
    meetingId: 'mtg_1',
    // 서버 순서가 B, A여도 화면은 A, B
    candidates: [candidate('B', '골목과 온천'), candidate('A', '바다 따라 걷기')],
    choice: { votes: votes.map(([memberId, l]) => ({ memberId, planId: `pln_${l}` })), answered: votes.length, total: 4, chosen },
    plan: null,
    edits: [],
    confirm: null,
    confirmedAt: null,
  };
}

const chosen = (label: 'A' | 'B', A: number, B: number, by: 'all' | 'host' = 'all'): PlanChosen => ({
  planId: `pln_${label}`,
  label,
  by,
  tie: A === B,
  votes: { A, B },
});

test('choiceStage: 안 고름 → choose, 고름 → waiting, 정해짐 → decided, 일정 표 없음 → null', () => {
  assert.equal(choiceStage(null, 'mem_1'), null);
  assert.equal(choiceStage(board([['mem_2', 'A']]), 'mem_1'), 'choose');
  assert.equal(choiceStage(board([['mem_1', 'B']]), 'mem_1'), 'waiting');
  assert.equal(choiceStage(board([], chosen('A', 3, 1), 'revising'), 'mem_1'), 'decided');
});

test('boardPlans: A·B 순서, 서버 이름·경로·안내', () => {
  const plans = boardPlans(board([]));
  assert.deepEqual(plans.map((p) => [p.label, p.title, p.notes[0]]), [
    ['A', '바다 따라 걷기', 'A 안내'],
    ['B', '골목과 온천', 'B 안내'],
  ]);
});

test('choicePeople: 골랐는지와 나, 구성원 순서', () => {
  const people = choicePeople(board([['mem_3', 'B'], ['mem_1', 'A']]), members, 'mem_1');
  assert.deepEqual(people.map((p) => [p.name, p.done, p.me]), [
    ['민수', true, true],
    ['지은', false, false],
    ['현우', true, false],
    ['서연', false, false],
  ]);
  assert.equal(myChoice(board([['mem_3', 'B']]), 'mem_3'), 'pln_B');
  assert.equal(myChoice(board([]), 'mem_3'), null);
});

test('choiceResult: 3:1이면 "정했어요"와 표 수', () => {
  const r = choiceResult(board([['mem_1', 'A']], chosen('A', 3, 1)), 'mem_1');
  assert.deepEqual(r, {
    title: '바다 따라 걷기',
    head: '정했어요',
    rows: [
      { name: '바다 따라 걷기', votes: 3, win: true },
      { name: '골목과 온천', votes: 1, win: false },
    ],
    hostPick: false,
  });
});

test('choiceResult: 2:2에 방장이 고른 안이면 그 까닭과 방장 표시, 아니면 AI 만족도 까닭', () => {
  const host = choiceResult(board([['mem_1', 'B']], chosen('B', 2, 2)), 'mem_1');
  assert.equal(host?.head, '2:2라서 방장이 고른 안으로 정했어요');
  assert.equal(host?.hostPick, true);
  const ai = choiceResult(board([], chosen('A', 1, 1, 'host')), 'mem_1');
  assert.equal(ai?.head, '표가 같아서 AI가 더 만족한 안으로 정했어요');
  assert.equal(ai?.hostPick, false);
  assert.equal(choiceResult(board([]), 'mem_1'), null);
});

test('demoChoices: 4명이면 다른 3명 중 앞의 둘은 방장과 같은 안, 마지막은 다른 안(3:1)', () => {
  assert.deepEqual(demoChoices(board([['mem_1', 'B']]), members, 'mem_1'), [
    { memberId: 'mem_2', planId: 'pln_B' },
    { memberId: 'mem_3', planId: 'pln_B' },
    { memberId: 'mem_4', planId: 'pln_A' },
  ]);
});

test('demoChoices: 이미 고른 사람은 빼고, 방장이 안 골랐거나 정해졌으면 없음', () => {
  assert.deepEqual(demoChoices(board([['mem_1', 'A'], ['mem_2', 'A']]), members, 'mem_1'), [
    { memberId: 'mem_3', planId: 'pln_A' },
    { memberId: 'mem_4', planId: 'pln_B' },
  ]);
  assert.deepEqual(demoChoices(board([['mem_2', 'A']]), members, 'mem_1'), []);
  assert.deepEqual(demoChoices(board([['mem_1', 'A']], chosen('A', 3, 1), 'revising'), members, 'mem_1'), []);
});

test('demoChoices: 다른 구성원이 한 명뿐이면 방장과 같은 안(2명 여행)', () => {
  assert.deepEqual(demoChoices(board([['mem_1', 'A']]), members.slice(0, 2), 'mem_1'), [{ memberId: 'mem_2', planId: 'pln_A' }]);
});
