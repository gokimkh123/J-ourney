import test from 'node:test';
import assert from 'node:assert/strict';

import { homeActions } from './homeActions.ts';
import type { ActionMember } from './homeActions.ts';

const m = (id: string, nickname: string, isHost: boolean, personaReady: boolean): ActionMember => ({
  id,
  nickname,
  isHost,
  personaReady,
});

const host = m('m1', '민수', true, true);
const jieun = m('m2', '지은', false, true);
const hyunwoo = m('m3', '현우', false, false);
const seoyeon = m('m4', '서연', false, false);

test('방장 · 일부만 완료: 공유와 재촉(안 한 사람 이름), 시작은 없다', () => {
  const a = homeActions([host, jieun, hyunwoo, seoyeon], 'm1', 'waiting');
  assert.equal(a.isHost, true);
  assert.equal(a.canShare, false); // 4명이라 자리 없음
  assert.deepEqual(a.nudgeTargets, ['현우', '서연']);
  assert.equal(a.canStart, false);
  assert.equal(a.canNudgeHost, false);
});

test('자리가 남으면 공유 버튼이 뜬다', () => {
  assert.equal(homeActions([host, hyunwoo], 'm1', 'waiting').canShare, true);
});

test('방장 · 전원 완료: 회의 시작하기, 재촉은 없다', () => {
  const a = homeActions([host, jieun], 'm1', 'conditions');
  assert.equal(a.canStart, true);
  assert.equal(a.canNudgeHost, false);
  assert.deepEqual(a.nudgeTargets, []);
  assert.equal(a.canShare, true);
});

test('방장 혼자여도 시작할 수 있다', () => {
  assert.equal(homeActions([host], 'm1', 'conditions').canStart, true);
});

test('멤버 · 일부만 완료: 공유와 재촉은 되고 시작은 안 된다', () => {
  const a = homeActions([host, jieun, hyunwoo], 'm2', 'waiting');
  assert.equal(a.isHost, false);
  assert.deepEqual(a.nudgeTargets, ['현우']);
  assert.equal(a.canStart, false);
});

test('멤버 · 전원 완료: 방장 재촉하기', () => {
  const a = homeActions([host, jieun], 'm2', 'conditions');
  assert.equal(a.canNudgeHost, true);
  assert.equal(a.canStart, false);
});

test('성향 검사 전·회의 중·결과 단계에서는 버튼을 더하지 않는다', () => {
  for (const step of ['persona', 'meeting', 'result'] as const) {
    const a = homeActions([host, jieun], 'm1', step);
    assert.deepEqual(a, { isHost: true, canShare: false, nudgeTargets: [], canStart: false, canNudgeHost: false });
  }
});

test('구성원 목록을 못 받았으면 아무 버튼도 띄우지 않는다', () => {
  const a = homeActions(null, 'm1', 'persona');
  assert.deepEqual(a, { isHost: false, canShare: false, nudgeTargets: [], canStart: false, canNudgeHost: false });
});
