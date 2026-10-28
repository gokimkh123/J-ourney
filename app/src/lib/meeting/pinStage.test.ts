import test from 'node:test';
import assert from 'node:assert/strict';

import { arrive, backlog, initialPinStage, isPlanted, sameStage, stageSpot, syncPins } from './pinStage.ts';

const cand = (placeId: string, proposedBy: string[], lat = 35, lng = 129) => ({ placeId, proposedBy, lat, lng });
const AGENTS = ['a1', 'a2'];

test('새 후보는 제안한 AI가 걸어가기 시작하고, 도착하기 전에는 꽂히지 않는다', () => {
  const stage = syncPins(initialPinStage(), [cand('p1', ['a1'])], AGENTS, true);
  assert.deepEqual(stage.walking, { a1: 'p1' });
  assert.equal(isPlanted(stage, 'p1'), false);
});

test('도착하면 핀이 꽂히고, 그 자리에 서 있는다', () => {
  const candidates = [cand('p1', ['a1'], 35.1, 129.1)];
  let stage = syncPins(initialPinStage(), candidates, AGENTS, true);
  stage = arrive(stage, 'a1', 'k0');
  assert.equal(isPlanted(stage, 'p1'), true);
  assert.deepEqual(stage.walking, {});
  assert.deepEqual(stageSpot(stage, 'a1', candidates, 'k0'), { lat: 35.1, lng: 129.1 });
});

test('같은 AI의 후보는 한 곳씩 차례로, 다른 AI는 동시에 걷는다', () => {
  const candidates = [cand('p1', ['a1']), cand('p2', ['a1']), cand('p3', ['a2'])];
  let stage = syncPins(initialPinStage(), candidates, AGENTS, true);
  assert.deepEqual(stage.walking, { a1: 'p1', a2: 'p3' });
  assert.equal(backlog(stage, 'a1'), 1);
  assert.equal(backlog(stage, 'a2'), 0);

  stage = arrive(stage, 'a1', 'k');
  assert.equal(isPlanted(stage, 'p1'), true);
  assert.equal(isPlanted(stage, 'p2'), false);
  assert.deepEqual(stage.walking, { a1: 'p2', a2: 'p3' });
  assert.equal(backlog(stage, 'a1'), 0);
});

test('같은 목록으로 다시 맞춰도 아무것도 바뀌지 않는다', () => {
  const candidates = [cand('p1', ['a1']), cand('p2', ['a1'])];
  const once = syncPins(initialPinStage(), candidates, AGENTS, true);
  const twice = syncPins(once, candidates, AGENTS, true);
  assert.deepEqual(twice, once);
});

test('후보는 도착한 순서가 아니라 목록에 나타난 순서대로 줄을 선다', () => {
  let stage = syncPins(initialPinStage(), [cand('p1', ['a1'])], AGENTS, true);
  stage = syncPins(stage, [cand('p1', ['a1']), cand('p2', ['a1'])], AGENTS, true);
  stage = syncPins(stage, [cand('p1', ['a1']), cand('p2', ['a1']), cand('p3', ['a1'])], AGENTS, true);
  assert.deepEqual(stage.walking, { a1: 'p1' });
  assert.deepEqual(stage.queues, { a1: ['p2', 'p3'] });
});

test('제안한 AI가 여럿이면 목록에 있는 첫 AI가 맡는다', () => {
  const stage = syncPins(initialPinStage(), [cand('p1', ['ghost', 'a2', 'a1'])], AGENTS, true);
  assert.deepEqual(stage.walking, { a2: 'p1' });
});

test('제안한 AI가 없거나 목록에 없으면 걷게 하지 않고 바로 꽂는다', () => {
  const stage = syncPins(initialPinStage(), [cand('p1', []), cand('p2', ['ghost'])], AGENTS, true);
  assert.deepEqual(stage.planted, ['p1', 'p2']);
  assert.deepEqual(stage.walking, {});
});

test('animate가 false면 걷는 중이던 것과 기다리던 것까지 모두 바로 꽂고 서 있는 자리를 지운다', () => {
  const candidates = [cand('p1', ['a1']), cand('p2', ['a1']), cand('p3', ['a2'])];
  let stage = syncPins(initialPinStage(), candidates, AGENTS, true);
  stage = arrive(stage, 'a2', 'k');
  stage = syncPins(stage, candidates, AGENTS, false);
  assert.deepEqual([...stage.planted].sort(), ['p1', 'p2', 'p3']);
  assert.deepEqual(stage.walking, {});
  assert.deepEqual(stage.queues, {});
  assert.deepEqual(stage.standing, {});
});

test('목록에서 사라진 후보는 걷던 것도 기다리던 것도 꽂힌 것도 지우고, 다음 후보를 걷게 한다', () => {
  let stage = syncPins(initialPinStage(), [cand('p1', ['a1']), cand('p2', ['a1'])], AGENTS, true);
  stage = syncPins(stage, [cand('p2', ['a1'])], AGENTS, true);
  assert.deepEqual(stage.walking, { a1: 'p2' });

  stage = arrive(stage, 'a1', 'k');
  stage = syncPins(stage, [], AGENTS, true);
  assert.deepEqual(stage, initialPinStage());
});

test('걷는 중이 아닌 AI에게 도착을 알려도 아무것도 바뀌지 않는다', () => {
  const stage = syncPins(initialPinStage(), [cand('p1', ['a1'])], AGENTS, true);
  assert.equal(arrive(stage, 'a2', 'k'), stage);
});

test('서 있는 자리는 서버 위치가 같을 때만 따르고, 바뀌면 서버 위치를 따른다', () => {
  const candidates = [cand('p1', ['a1'], 35.2, 129.2)];
  let stage = syncPins(initialPinStage(), candidates, AGENTS, true);
  stage = arrive(stage, 'a1', 'focus-A');
  assert.deepEqual(stageSpot(stage, 'a1', candidates, 'focus-A'), { lat: 35.2, lng: 129.2 });
  assert.equal(stageSpot(stage, 'a1', candidates, 'focus-B'), undefined);
  assert.equal(stageSpot(stage, 'a2', candidates, 'focus-A'), undefined);
});

test('걷는 중에는 서버 위치가 바뀌어도 가던 곳이 우선이다', () => {
  const candidates = [cand('p1', ['a1'], 35.3, 129.3)];
  const stage = syncPins(initialPinStage(), candidates, AGENTS, true);
  assert.deepEqual(stageSpot(stage, 'a1', candidates, 'whatever'), { lat: 35.3, lng: 129.3 });
});

test('입력 목록과 이전 단계 값을 바꾸지 않는다', () => {
  const candidates = [cand('p1', ['a1']), cand('p2', ['a1'])];
  const copy = JSON.parse(JSON.stringify(candidates));
  const first = syncPins(initialPinStage(), candidates, AGENTS, true);
  const firstCopy = JSON.parse(JSON.stringify(first));
  arrive(first, 'a1', 'k');
  syncPins(first, [], AGENTS, false);
  assert.deepEqual(candidates, copy);
  assert.deepEqual(first, firstCopy);
});

test('sameStage: 내용이 같으면 같다고 하고, 빈 목록으로 다시 맞춰도 상태가 같다(다시 그리기 반복 방지)', () => {
  const empty = initialPinStage();
  assert.equal(sameStage(empty, syncPins(empty, [], ['agt_01'], false)), true);
  assert.equal(sameStage(empty, syncPins(empty, [], ['agt_01'], true)), true);
  const walking = syncPins(empty, [{ placeId: 'plc_01', proposedBy: ['agt_01'] }], ['agt_01'], true);
  assert.equal(sameStage(walking, structuredClone(walking)), true);
  assert.equal(sameStage(empty, walking), false);
});
