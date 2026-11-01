import assert from 'node:assert/strict';
import test from 'node:test';

import { callName, homeBubble, waitingTitle } from './homeBubble.ts';

const m = (id: string, nickname: string, personaReady: boolean) => ({ id, nickname, personaReady });

test('callName은 받침에 따라 아·야를 붙인다', () => {
  assert.equal(callName('지은'), '지은아,');
  assert.equal(callName('현우'), '현우야,');
  assert.equal(callName('Mina'), 'Mina,');
  assert.equal(callName(''), ',');
});

test('나만 성향 검사 전이면 준비된 친구가 나를 부른다', () => {
  const members = [m('a', '민수', false), m('b', '지은', true), m('c', '현우', true)];
  assert.deepEqual(homeBubble('persona', members, 'a'), { speakerId: 'b', text: '민수만 오면 돼요!' });
});

test('다른 사람도 검사 전이면 함께 하자고 한다', () => {
  const members = [m('a', '민수', false), m('b', '지은', true), m('c', '현우', false)];
  assert.deepEqual(homeBubble('persona', members, 'a'), { speakerId: 'b', text: '같이 성향 검사해요!' });
});

test('준비된 친구가 없으면 말풍선이 없다', () => {
  assert.equal(homeBubble('persona', [m('a', '민수', false)], 'a'), null);
});

test('기다리는 중에는 내가 안 한 친구를 부른다', () => {
  const one = [m('a', '민수', true), m('b', '지은', true), m('c', '현우', false)];
  assert.deepEqual(homeBubble('waiting', one, 'a'), { speakerId: 'a', text: '현우야, 같이 가자!' });
  const two = [m('a', '민수', true), m('b', '지은', false), m('c', '현우', false)];
  assert.deepEqual(homeBubble('waiting', two, 'a'), { speakerId: 'a', text: '얘들아, 같이 가자!' });
});

test('뒤 단계는 첫 구성원이 말한다', () => {
  const members = [m('a', '민수', true), m('b', '지은', true)];
  assert.equal(homeBubble('result', members, 'b')?.speakerId, 'a');
  assert.equal(homeBubble('result', members, 'b')?.text, 'AI들이 합의했어요!');
});

test('구성원 목록에 내가 없으면 말풍선이 없다', () => {
  assert.equal(homeBubble('conditions', [m('a', '민수', true)], 'x'), null);
});

test('waitingTitle은 받침에 맞는 조사를 붙이고 여럿이면 인원을 센다', () => {
  assert.equal(waitingTitle(['현우']), '현우를 기다리는 중');
  assert.equal(waitingTitle(['지은']), '지은을 기다리는 중');
  assert.equal(waitingTitle(['Mina']), 'Mina을(를) 기다리는 중');
  assert.equal(waitingTitle(['지은', '현우']), '친구 2명을 기다리는 중');
});
