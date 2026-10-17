import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GATHER_POINT, keepAgentsVisible, type MapAgentData, type Position } from './agentPositions.ts';
import { busanEvents } from './fixtures/busan.ts';
import { eventsUntilFirstAgreed } from './player.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import type { AgentInfo } from './types.ts';
import { mapAgents } from './view.ts';

const roster: AgentInfo[] = [
  { agentId: 'a', memberId: 'm1', nickname: '가', title: '', chips: [], color: '#111111' },
  { agentId: 'b', memberId: 'm2', nickname: '나', title: '', chips: [], color: '#222222' },
];

const at = (id: string, lat: number, lng: number): MapAgentData => ({
  id,
  name: id,
  color: '#000000',
  chips: [],
  lat,
  lng,
  searching: true,
});

test('위치가 없는 AI는 모이는 곳에 서고, 참가자 순서를 지킨다', () => {
  const memory = new Map<string, Position>();
  const result = keepAgentsVisible([], roster, memory);
  assert.deepEqual(
    result.map((a) => [a.id, a.lat, a.lng, a.searching]),
    [
      ['a', GATHER_POINT.lat, GATHER_POINT.lng, false],
      ['b', GATHER_POINT.lat, GATHER_POINT.lng, false],
    ],
  );
  assert.equal(result[0]!.name, '가');
});

test('위치가 잠깐 비면 마지막 위치에 머문다', () => {
  const memory = new Map<string, Position>();
  keepAgentsVisible([at('a', 35.2, 129.1)], roster, memory);
  const result = keepAgentsVisible([], roster, memory);
  const a = result.find((x) => x.id === 'a')!;
  assert.equal(a.lat, 35.2);
  assert.equal(a.lng, 129.1);
});

test('새 위치가 오면 따라가고, 참가자가 비면 기억을 지운다', () => {
  const memory = new Map<string, Position>();
  keepAgentsVisible([at('a', 35.2, 129.1)], roster, memory);
  const moved = keepAgentsVisible([at('a', 35.3, 129.2)], roster, memory);
  assert.equal(moved.find((x) => x.id === 'a')!.lat, 35.3);
  keepAgentsVisible([], [], memory);
  assert.equal(memory.size, 0);
  const fresh = keepAgentsVisible([], roster, memory);
  assert.equal(fresh.find((x) => x.id === 'a')!.lat, GATHER_POINT.lat);
});

test('부산 회의 전체: 회의가 시작된 뒤로는 어느 시점에도 모든 AI가 보인다', () => {
  const memory = new Map<string, Position>();
  let state = initialMeetingState();
  let checked = 0;
  for (const event of eventsUntilFirstAgreed(busanEvents)) {
    state = applyEvent(state, event).state;
    if (state.agents.length === 0) continue;
    const shown = keepAgentsVisible(mapAgents(state), state.agents, memory);
    assert.equal(shown.length, state.agents.length);
    assert.ok(shown.every((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng)));
    checked += 1;
  }
  assert.ok(checked > 40);
});
