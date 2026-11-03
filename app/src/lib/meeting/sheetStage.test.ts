import test from 'node:test';
import assert from 'node:assert/strict';

import { sheetLevelFor } from './sheetStage.ts';

test('① 조사 시작: 대기 → 조사면 가운데', () => {
  assert.equal(sheetLevelFor('idle', 'researching', true), 1);
  assert.equal(sheetLevelFor('idle', 'researching', false), 1);
});

test('③ 사람 확인: 펼침', () => {
  assert.equal(sheetLevelFor('researching', 'reviewing', true), 2);
});

test('⑤ 사람 확인 뒤 동선 짜기: 가운데로 내림', () => {
  assert.equal(sheetLevelFor('reviewing', 'researching', true), 1);
});

test('⑧ 합의 뒤 A·B 고르기: 실서버만 펼침(예시 재생은 고르기가 없어 그대로)', () => {
  assert.equal(sheetLevelFor('meeting', 'agreed', true), 3);
  assert.equal(sheetLevelFor('meeting', 'agreed', false), null);
});

test('그 밖의 단계 바뀜이나 같은 단계는 그대로', () => {
  assert.equal(sheetLevelFor('researching', 'proposed', true), null);
  assert.equal(sheetLevelFor('proposed', 'meeting', true), null);
  assert.equal(sheetLevelFor('reviewing', 'reviewing', true), null);
});
