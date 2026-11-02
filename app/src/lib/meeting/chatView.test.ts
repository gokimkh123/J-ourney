import test from 'node:test';
import assert from 'node:assert/strict';

import { chatItems, myAgentIdOf, roundLabel } from './chatView.ts';
import type { ChatSource } from './chatView.ts';

const m = (seq: number, agentId: string, round: number, text = `말${seq}`): ChatSource => ({
  seq,
  agentId,
  name: agentId === 'agt_me' ? '민수' : agentId === 'agt_2' ? '지은' : '현우',
  color: '#111111',
  chips: [],
  text,
  round,
});

test('roundLabel: 0은 조사 중', () => {
  assert.equal(roundLabel(0), '조사 중');
  assert.equal(roundLabel(2), '2라운드');
});

test('오래된 말이 위, 라운드가 바뀔 때마다 구분 줄', () => {
  const items = chatItems([m(5, 'agt_2', 2), m(1, 'agt_2', 1), m(3, 'agt_me', 1)], 'agt_me');
  assert.deepEqual(items.map((i) => (i.type === 'divider' ? i.label : i.text)), ['1라운드', '말1', '말3', '2라운드', '말5']);
});

test('내 말은 mine·이름 없음, 다른 AI는 이름', () => {
  const items = chatItems([m(1, 'agt_2', 1), m(2, 'agt_me', 1)], 'agt_me').filter((i) => i.type === 'message');
  assert.deepEqual(items.map((i) => i.type === 'message' && [i.mine, i.name]), [
    [false, '지은'],
    [true, null],
  ]);
});

test('같은 AI가 이어서 말하면 이름은 첫 말, 얼굴은 마지막 말에만', () => {
  const items = chatItems([m(1, 'agt_2', 1), m(2, 'agt_2', 1), m(3, 'agt_2', 1), m(4, 'agt_3', 1)], 'agt_me').filter((i) => i.type === 'message');
  assert.deepEqual(items.map((i) => i.type === 'message' && [i.name, i.face?.name ?? null]), [
    ['지은', null],
    [null, null],
    [null, '지은'],
    ['현우', '현우'],
  ]);
});

test('라운드가 바뀌면 같은 AI라도 묶음이 끊긴다', () => {
  const items = chatItems([m(1, 'agt_2', 1), m(2, 'agt_2', 2)], null).filter((i) => i.type === 'message');
  assert.deepEqual(items.map((i) => i.type === 'message' && [i.name, i.face !== null]), [
    ['지은', true],
    ['지은', true],
  ]);
});

test('내 AI를 모르면 모두 다른 AI로 본다', () => {
  const items = chatItems([m(1, 'agt_me', 1)], null);
  assert.equal(items[1]?.type === 'message' && items[1].mine, false);
});

test('myAgentIdOf: 구성원 id로 에이전트 찾기', () => {
  const agents = [
    { agentId: 'agt_me', memberId: 'mem_1' },
    { agentId: 'agt_2', memberId: 'mem_2' },
  ];
  assert.equal(myAgentIdOf(agents, 'mem_2'), 'agt_2');
  assert.equal(myAgentIdOf(agents, 'mem_9'), null);
  assert.equal(myAgentIdOf(agents, null), null);
});
