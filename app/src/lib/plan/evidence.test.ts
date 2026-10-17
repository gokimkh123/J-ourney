import assert from 'node:assert/strict';
import test from 'node:test';

import { placeEvidenceRows } from './evidence.ts';
import { busanPlan } from './fixtures/busanPlan.ts';
import type { PlanPlace } from './types.ts';

const base: PlanPlace = busanPlan.days[0]!.items[0]!.place;

test('출처 이름·기준일·확인 시각을 사람이 읽는 글로 바꾼다', () => {
  assert.deepEqual(placeEvidenceRows(base), [
    { label: '출처', value: '한국관광공사 · 카카오맵' },
    { label: '기준일', value: '2026.10.01' },
    { label: '확인일', value: '10월 24일 14:00' },
  ]);
});

test('모르는 출처는 그대로, 같은 이름은 한 번만', () => {
  const rows = placeEvidenceRows({ ...base, sources: ['tourapi', 'tour', 'blog'] });
  assert.equal(rows[0]!.value, '한국관광공사 · blog');
});

test('비어 있거나 형식이 다르면 정보 없음 또는 원문', () => {
  const rows = placeEvidenceRows({ ...base, sources: [], baseDate: '', checkedAt: '어제' });
  assert.deepEqual(rows.map((r) => r.value), ['정보 없음', '정보 없음', '어제']);
});

test('객체 기본 속성 이름은 출처 이름으로 바뀌지 않는다', () => {
  assert.equal(placeEvidenceRows({ ...base, sources: ['toString'] })[0]!.value, 'toString');
});
