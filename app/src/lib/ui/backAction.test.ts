import test from 'node:test';
import assert from 'node:assert/strict';

import { backAction } from './backAction.ts';

test('큰 탭에서 뒤로 가면 홈으로 간다', () => {
  for (const path of ['/meeting', '/plan', '/persona', '/community']) {
    assert.equal(backAction(path, true), 'home');
    assert.equal(backAction(path, false), 'home');
  }
});

test('홈에서는 파티 안이면 파티 목록으로, 밖이면 앱을 닫는다', () => {
  assert.equal(backAction('/', true), 'exitParty');
  assert.equal(backAction('/', false), 'exitApp');
});

test('숨은 화면은 연 화면으로(내비게이터 기록) 돌아간다', () => {
  for (const path of ['/settings', '/conditions', '/agreement', '/questionnaire', '/place/plc_1', '/community/plc_2', '/invite/BSN482']) {
    assert.equal(backAction(path, true), 'history');
  }
});
