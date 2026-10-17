import test from 'node:test';
import assert from 'node:assert/strict';

import { busanEvents } from './fixtures/busan.ts';
import { eventsUntilFirstAgreed } from './player.ts';
import { applyEvent, initialMeetingState } from './reducer.ts';
import type { MeetingEvent, MeetingState } from './types.ts';
import {
  agentRows,
  agreementView,
  candidateRows,
  currentBubble,
  mapAgents,
  mapPins,
  mapPoints,
  membersOf,
  phaseLabel,
  speechFeed,
} from './view.ts';

// 조건을 만족하는 첫 이벤트까지(포함) 적용한 상태
function stateAt(pred: (e: MeetingEvent) => boolean): MeetingState {
  const index = busanEvents.findIndex(pred);
  assert.ok(index >= 0);
  let state = initialMeetingState();
  for (const event of busanEvents.slice(0, index + 1)) state = applyEvent(state, event).state;
  return state;
}

const researching = () =>
  stateAt((e) => e.type === 'research.progress' && e.data.stage === 'done');
const meeting = () =>
  stateAt((e) => e.type === 'agent.message' && e.data.agentId === 'agt_02' && e.data.round === 1);
const agreed = () => stateAt((e) => e.type === 'meeting.agreed');

const ALL = {
  membersOf,
  phaseLabel,
  agentRows,
  mapAgents,
  mapPins,
  candidateRows,
  speechFeed,
  currentBubble,
  mapPoints,
  agreementView,
};

test('조사 중 모든 시점: 행 수, 상태 문구, 위치 불변식', () => {
  let state = initialMeetingState();
  let checked = 0;
  for (const event of busanEvents) {
    state = applyEvent(state, event).state;
    if (event.type !== 'research.progress' || state.phase !== 'researching') continue;
    checked += 1;
    const rows = agentRows(state);
    assert.equal(rows.length, state.agents.length);
    rows.forEach((row, i) => {
      assert.ok(row.statusLabel === '조사 중' || row.statusLabel === '완료');
      assert.equal(row.statusLabel === '완료', state.research[state.agents[i]!.agentId]?.stage === 'done');
      assert.equal(row.active, false);
    });
    const agents = mapAgents(state);
    for (const a of agents) {
      assert.ok(Number.isFinite(a.lat) && Number.isFinite(a.lng));
      assert.ok(state.agents.some((x) => x.agentId === a.id));
      assert.equal(a.searching, state.research[a.id]?.stage !== 'done');
    }
    const located = state.agents.filter(
      (x) =>
        state.research[x.agentId]?.focus != null ||
        state.board.candidates.some((c) => c.proposedBy.includes(x.agentId)),
    );
    assert.equal(agents.length, located.length);
  }
  assert.ok(checked > 0);
  assert.equal(phaseLabel(researching()), 'AI들이 장소를 조사하고 있어요');
});

test('조사 중 마지막 searching 직후: 모든 AI 가 focus 위치를 가짐', () => {
  const lastSeq = Math.max(
    ...busanEvents
      .filter((e) => e.type === 'research.progress' && e.data.stage === 'searching')
      .map((e) => e.seq),
  );
  const state = stateAt((e) => e.seq === lastSeq);
  assert.equal(state.phase, 'researching');
  const agents = mapAgents(state);
  assert.equal(agents.length, state.agents.length);
  assert.ok(agents.length >= 1);
  for (const a of agents) {
    const focus = state.research[a.id]?.focus;
    assert.ok(focus != null);
    assert.equal(a.lat, focus.lat);
    assert.equal(a.lng, focus.lng);
    assert.equal(a.searching, true);
  }
  assert.ok(agentRows(state).every((r) => r.statusLabel === '조사 중'));
});

test('회의 중 상태: 라벨, 말풍선, active 가 마지막 발언자와 일치', () => {
  const state = meeting();
  assert.equal(phaseLabel(state), '1/3라운드 회의 중');
  const feed = speechFeed(state);
  const last = feed.at(-1);
  assert.ok(last !== undefined);
  assert.equal(last.agentId, 'agt_02');
  assert.equal(last.meta, '1라운드');
  assert.deepEqual(currentBubble(state), { agentId: last.agentId, text: last.text });
  const rows = agentRows(state);
  const active = rows.filter((r) => r.active);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.name, '지은');
  assert.ok(rows.every((r) => r.statusLabel === '회의 중'));
  assert.deepEqual(
    feed.map((f) => f.seq),
    [...feed.map((f) => f.seq)].sort((a, b) => a - b),
  );
});

test('합의 직후: agreementView 통계·만족도·양보', () => {
  const state = agreed();
  assert.equal(state.phase, 'agreed');
  assert.equal(phaseLabel(state), '합의안이 나왔어요');
  assert.equal(currentBubble(state), null);
  assert.ok(agentRows(state).every((r) => !r.active));
  const view = agreementView(state);
  assert.ok(view !== null);
  assert.deepEqual(view.stats, [
    { value: '2분 34초', label: '걸린 시간' },
    { value: '3번', label: '제안' },
    { value: '5번', label: '수정' },
  ]);
  assert.equal(view.satisfaction.length, 4);
  assert.ok(view.concessions.length >= 1);
  assert.deepEqual(
    view.satisfaction.map((s) => s.score),
    state.agreement?.satisfaction.map((s) => s.score),
  );
  assert.deepEqual(
    agentRows(state).map((r) => r.statusLabel),
    ['찬성', '찬성', '찬성', '찬성'],
  );
});

test('mapPins 와 candidateRows: id 와 순번이 일치', () => {
  const state = agreed();
  const pins = mapPins(state);
  const rows = candidateRows(state);
  const ids = state.board.candidates.map((c) => c.placeId);
  assert.deepEqual(pins.map((p) => p.id), ids);
  assert.deepEqual(rows.map((r) => r.placeId), ids);
  assert.ok(pins.some((p) => p.label !== undefined));
  assert.ok(pins.some((p) => p.label === undefined));
  for (const pin of pins) {
    const row = rows.find((r) => r.placeId === pin.id);
    assert.ok(row !== undefined);
    if (pin.label === undefined) {
      assert.equal('label' in pin, false);
      assert.equal('order' in row, false);
    } else {
      assert.equal(row.order, Number(pin.label));
    }
    assert.equal(row.proposerColor, pin.color);
  }
  assert.equal(pins.find((p) => p.id === 'plc_01')?.label, '1');
  assert.equal(mapPoints(state).length, mapAgents(state).length + pins.length);
});

test('알 수 없는 agentId 반응·발언·memberId 는 건너뜀', () => {
  const state = structuredClone(agreed());
  const candidate = state.board.candidates[0];
  assert.ok(candidate !== undefined);
  const before = candidate.reactions.length;
  candidate.reactions.push({ agentId: 'ghost', kind: 'like', reason: 'x' });
  state.timeline.push({
    kind: 'message', seq: 9999, at: 'x', agentId: 'ghost', round: 1, text: 'boo', places: [],
  });
  state.agreement?.satisfaction.push({ memberId: 'ghost', score: 1 });
  state.agreement?.concessions.push({ memberId: 'ghost', gave: 'a', got: 'b' });
  assert.equal(candidateRows(state)[0]?.reactions.length, before);
  assert.ok(speechFeed(state).every((f) => f.agentId !== 'ghost'));
  assert.equal(agreementView(state)?.satisfaction.length, 4);
  assert.equal(agreementView(state)?.concessions.length, 2);
});

test('initialMeetingState: 빈 값을 돌려주고 예외 없음', () => {
  const state = initialMeetingState();
  assert.deepEqual(membersOf(state), []);
  assert.equal(phaseLabel(state), '대기 중');
  assert.deepEqual(agentRows(state), []);
  assert.deepEqual(mapAgents(state), []);
  assert.deepEqual(mapPins(state), []);
  assert.deepEqual(candidateRows(state), []);
  assert.deepEqual(speechFeed(state), []);
  assert.equal(currentBubble(state), null);
  assert.deepEqual(mapPoints(state), []);
  assert.equal(agreementView(state), null);
});

test('함수 호출이 입력 상태를 바꾸지 않음', () => {
  for (const state of [initialMeetingState(), researching(), meeting(), agreed()]) {
    const before = JSON.stringify(state);
    for (const fn of Object.values(ALL)) fn(state);
    assert.equal(JSON.stringify(state), before);
  }
});

test('회의 중 알 수 없는 agentId 발언이 끼어도 말풍선·active 는 마지막 정상 발언자', () => {
  const state = structuredClone(meeting());
  const maxSeq = Math.max(...state.timeline.map((t) => t.seq));
  state.timeline.push({
    kind: 'message', seq: maxSeq + 1, at: 'x', agentId: 'ghost', round: 1, text: 'boo', places: [],
  });
  const last = speechFeed(state).at(-1);
  assert.ok(last !== undefined);
  assert.equal(last.agentId, 'agt_02');
  assert.deepEqual(currentBubble(state), { agentId: 'agt_02', text: last.text });
  const active = agentRows(state).filter((r) => r.active);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.name, '지은');
});

test('회의 중 말한 AI는 확인한 장소 후보 위치로 이동한다', () => {
  let state = initialMeetingState();
  let moved = 0;
  for (const event of busanEvents) {
    state = applyEvent(state, event).state;
    if (state.phase !== 'meeting' || event.type !== 'place.checked') continue;
    const speaker = state.timeline.filter((t) => t.kind === 'message').at(-1);
    if (speaker === undefined || speaker.kind !== 'message') continue;
    const place = speaker.places.at(-1);
    const candidate = state.board.candidates.find((c) => c.name === place?.name);
    if (candidate === undefined) continue;
    const agent = mapAgents(state).find((a) => a.id === speaker.agentId);
    assert.ok(agent !== undefined);
    assert.equal(agent.lat, candidate.lat);
    assert.equal(agent.lng, candidate.lng);
    moved += 1;
  }
  assert.ok(moved > 0);
});

test('다른 AI가 말해도 이미 장소로 간 AI는 제자리로 돌아가지 않는다', () => {
  let state = initialMeetingState();
  const moved = new Map<string, { lat: number; lng: number }>();
  let checked = 0;
  for (const event of eventsUntilFirstAgreed(busanEvents)) {
    state = applyEvent(state, event).state;
    if (state.phase !== 'meeting') continue;
    for (const agent of mapAgents(state)) {
      const before = moved.get(agent.id);
      if (before !== undefined) {
        // 한번 장소로 간 AI는 새 장소를 확인하기 전까지 같은 자리에 있다.
        const msgs = state.timeline.filter((t) => t.kind === 'message' && t.agentId === agent.id);
        const lastPlace = msgs.length === 0 ? undefined : msgs[msgs.length - 1];
        if (lastPlace !== undefined && lastPlace.kind === 'message' && lastPlace.places.length === 0) {
          assert.deepEqual({ lat: agent.lat, lng: agent.lng }, before);
          checked += 1;
        }
      }
    }
    const speaker = state.timeline.filter((t) => t.kind === 'message').at(-1);
    if (speaker === undefined || speaker.kind !== 'message') continue;
    const place = speaker.places.at(-1);
    const candidate = state.board.candidates.find((c) => c.name === place?.name);
    if (candidate !== undefined) moved.set(speaker.agentId, { lat: candidate.lat, lng: candidate.lng });
  }
  assert.ok(moved.size > 0);
  assert.ok(checked > 0);
});
