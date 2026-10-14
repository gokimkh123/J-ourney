import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInstruction, parseEvent } from './parse.ts';

const base = { tripId: 'trp_8f3k2', at: '2026-10-24T14:03:11+09:00' };

test('parseEvent: round.started 정상 파싱', () => {
  const event = parseEvent(
    JSON.stringify({ ...base, type: 'round.started', seq: 3, data: { round: 1, maxRounds: 3 } }),
  );
  assert.deepEqual(event, {
    ...base,
    type: 'round.started',
    seq: 3,
    data: { round: 1, maxRounds: 3 },
  });
});

test('parseEvent: place.checked 정상 파싱 (null 필드 유지)', () => {
  const payload = {
    ...base,
    type: 'place.checked',
    seq: 7,
    data: {
      agentId: 'agt_01',
      place: { name: '해운대', openHours: null, review: null, placeUrl: 'https://example.com' },
    },
  };
  assert.deepEqual(parseEvent(JSON.stringify(payload)), payload);
});

test('parseEvent: 깨진 JSON은 null', () => {
  assert.equal(parseEvent('{not json'), null);
  assert.equal(parseEvent(''), null);
});

test('parseEvent: 객체가 아닌 JSON은 null', () => {
  assert.equal(parseEvent('null'), null);
  assert.equal(parseEvent('42'), null);
  assert.equal(parseEvent('[]'), null);
});

test('parseEvent: 알 수 없는 type은 null', () => {
  assert.equal(parseEvent(JSON.stringify({ ...base, type: 'foo.bar', seq: 1, data: {} })), null);
});

test('parseEvent: type 누락은 null', () => {
  assert.equal(parseEvent(JSON.stringify({ ...base, seq: 1, data: {} })), null);
});

test('parseEvent: seq 누락·비정수는 null', () => {
  assert.equal(
    parseEvent(JSON.stringify({ ...base, type: 'plan.confirmed', data: { planId: 'p' } })),
    null,
  );
  assert.equal(
    parseEvent(JSON.stringify({ ...base, type: 'plan.confirmed', seq: '1', data: { planId: 'p' } })),
    null,
  );
  assert.equal(
    parseEvent(JSON.stringify({ ...base, type: 'plan.confirmed', seq: 1.5, data: { planId: 'p' } })),
    null,
  );
});

test('parseEvent: ping이 아닌데 data가 객체가 아니면 null', () => {
  assert.equal(parseEvent(JSON.stringify({ ...base, type: 'plan.confirmed', seq: 1 })), null);
  assert.equal(
    parseEvent(JSON.stringify({ ...base, type: 'plan.confirmed', seq: 1, data: 'x' })),
    null,
  );
});

test('parseEvent: ping은 seq 없이도 통과', () => {
  assert.deepEqual(parseEvent('{"type":"ping"}'), { type: 'ping' });
});

test('parseEvent: seq가 있는 ping도 통과', () => {
  const event = parseEvent(JSON.stringify({ type: 'ping', tripId: 'trp_8f3k2', seq: 5 }));
  assert.equal(event?.type, 'ping');
});

test('buildInstruction: 정상', () => {
  assert.equal(
    buildInstruction('온천은 꼭 넣어 줘'),
    JSON.stringify({ type: 'user.instruction', data: { text: '온천은 꼭 넣어 줘' } }),
  );
});

test('buildInstruction: 앞뒤 공백 제거', () => {
  assert.equal(
    buildInstruction('  \n온천 포함\t '),
    JSON.stringify({ type: 'user.instruction', data: { text: '온천 포함' } }),
  );
});

test('buildInstruction: 빈 문자열·공백만 있으면 null', () => {
  assert.equal(buildInstruction(''), null);
  assert.equal(buildInstruction('   \n\t '), null);
});
