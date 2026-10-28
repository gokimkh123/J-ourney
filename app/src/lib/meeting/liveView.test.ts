import test from 'node:test';
import assert from 'node:assert/strict';

import { liveBanner, liveProgress } from './liveView.ts';

test('회의 단계가 끝(안 나옴·합의·실패·확정)이면 finished, 시작 전이면 idle, 나머지는 playing', () => {
  assert.equal(liveProgress('live', 'idle'), 'idle');
  for (const phase of ['researching', 'reviewing', 'meeting', 'confirming'] as const) assert.equal(liveProgress('live', phase), 'playing', phase);
  for (const phase of ['proposed', 'agreed', 'failed', 'confirmed'] as const) assert.equal(liveProgress('live', phase), 'finished', phase);
});

test('연결을 포기했거나 쫓겨나면 error, 잠깐 끊긴 건 진행 상태를 바꾸지 않는다', () => {
  assert.equal(liveProgress('failed', 'researching'), 'error');
  assert.equal(liveProgress('replaced', 'proposed'), 'error');
  assert.equal(liveProgress('reconnecting', 'researching'), 'playing');
  assert.equal(liveProgress('suspended', 'reviewing'), 'playing');
});

test('연결 안내: 정상이면 없고, 끊김·실패·쫓김은 문장이 있다', () => {
  for (const s of ['idle', 'live', 'suspended', 'disposed'] as const) assert.equal(liveBanner(s), null, s);
  for (const s of ['syncing', 'reconnecting', 'failed', 'replaced'] as const) assert.ok((liveBanner(s) ?? '').length > 5, s);
});
