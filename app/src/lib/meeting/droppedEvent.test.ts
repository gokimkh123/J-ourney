import assert from 'node:assert/strict';
import test from 'node:test';

import { droppedEventNote } from './droppedEvent.ts';

const base = { tripId: 't', at: 'x' };

test('읽을 수 있는 이벤트와 ping은 null', () => {
  assert.equal(droppedEventNote(JSON.stringify({ ...base, type: 'round.started', seq: 5, data: { round: 1, maxRounds: 5 } })), null);
  assert.equal(droppedEventNote(JSON.stringify({ type: 'ping' })), null);
});

test('모르는 종류는 종류와 번호만 알려 주고 내용은 담지 않는다', () => {
  const note = droppedEventNote(JSON.stringify({ ...base, type: 'round.summary', seq: 57, data: { secret: '비밀' } }));
  assert.equal(note, '못 읽은 이벤트 type=round.summary seq=57');
  assert.ok(!note!.includes('비밀'));
});

test('아는 종류여도 모양이 틀리면(번호 없음, data 없음) 알려 준다', () => {
  assert.equal(droppedEventNote(JSON.stringify({ ...base, type: 'vote.cast', data: {} })), '못 읽은 이벤트 type=vote.cast seq=?');
  assert.equal(droppedEventNote(JSON.stringify({ ...base, type: 'vote.cast', seq: 8 })), '못 읽은 이벤트 type=vote.cast seq=8');
});

test('시험용 llm.* 이벤트는 알리지 않는다', () => {
  assert.equal(droppedEventNote(JSON.stringify({ ...base, type: 'llm.delta', seq: 1, data: {} })), null);
});

test('JSON이 아니거나 객체가 아니면 그렇게 알려 주고, 이상한 종류는 ?로 가린다', () => {
  assert.equal(droppedEventNote('not json'), '못 읽은 메시지: JSON이 아님');
  assert.equal(droppedEventNote('[1,2]'), '못 읽은 메시지: 객체가 아님');
  assert.equal(droppedEventNote(JSON.stringify({ type: 'a b c', seq: 1, data: {} })), '못 읽은 이벤트 type=? seq=1');
});
