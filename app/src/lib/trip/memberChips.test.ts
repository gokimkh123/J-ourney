import assert from 'node:assert/strict';
import test from 'node:test';

import { memberChips } from './memberChips.ts';

const mine = [{ label: '계획형', emoji: '📋' }];
const sent = [{ label: '느긋형', emoji: '🐢' }];

test('서버가 보낸 칩이 있으면 그걸 쓴다', () => {
  assert.deepEqual(memberChips({ id: 'a', personaReady: true, chips: sent }, 'a', mine), sent);
  assert.deepEqual(memberChips({ id: 'b', personaReady: true, chips: sent }, 'a', mine), sent);
});

test('칩이 안 오면 나만 폰에 저장된 성향 칩을 쓴다', () => {
  assert.deepEqual(memberChips({ id: 'a', personaReady: true }, 'a', mine), mine);
  assert.deepEqual(memberChips({ id: 'b', personaReady: true }, 'a', mine), []);
});

test('성향 검사 전이면 칩이 없다', () => {
  assert.deepEqual(memberChips({ id: 'a', personaReady: false, chips: sent }, 'a', mine), []);
});
