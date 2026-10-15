import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api/errors.ts';
import {
  describeError,
  formatCount,
  inviteLink,
  normalizeInviteCode,
  sourceBadge,
  traitRatio,
  withAlpha,
} from './format.ts';

test('inviteLink: 코드를 대문자로', () => {
  assert.equal(inviteLink('BSN482'), 'journey://invite/BSN482');
  assert.equal(inviteLink('bsn482'), 'journey://invite/BSN482');
});

test('normalizeInviteCode: 공백·특수문자 제거와 대문자', () => {
  assert.equal(normalizeInviteCode(' bsn-482 '), 'BSN482');
  assert.equal(normalizeInviteCode('b s n 4 8 2'), 'BSN482');
  assert.equal(normalizeInviteCode('부산!bsn#482'), 'BSN482');
  assert.equal(normalizeInviteCode('BSN482'), 'BSN482');
  assert.equal(normalizeInviteCode('  -- '), '');
});

test('normalizeInviteCode: 대문자 변환 후 영문이 되는 문자는 남김', () => {
  assert.equal(normalizeInviteCode('ß-482'), 'SS482');
});

test('describeError: ApiError 종류별 문구', () => {
  assert.equal(
    describeError(new ApiError(404, 'NOT_FOUND', '없음')),
    '서버에 아직 준비되지 않은 기능이에요',
  );
  assert.equal(
    describeError(new ApiError(429, 'RATE_LIMITED', 'x')),
    '요청이 너무 많아요. 잠시 후 다시 시도해 주세요',
  );
  assert.equal(
    describeError(new ApiError(409, 'MEETING_IN_PROGRESS', 'x')),
    '회의가 시작되어 성향을 바꿀 수 없어요',
  );
  assert.equal(describeError(new ApiError(409, 'TRIP_FULL', 'x')), '여행 인원이 가득 찼어요');
  assert.equal(describeError(new ApiError(400, 'VALIDATION_ERROR', '3번 문항에 답해 주세요.')), '3번 문항에 답해 주세요.');
});

test('describeError: ApiError가 아닌 값은 알 수 없는 오류', () => {
  const unknown = '알 수 없는 오류가 발생했어요';
  assert.equal(describeError(new Error('boom')), unknown);
  assert.equal(describeError('text'), unknown);
  assert.equal(describeError(undefined), unknown);
});

test('formatCount', () => {
  assert.equal(formatCount(2, 5), '2/5');
  assert.equal(formatCount(0, 3), '0/3');
});

test('traitRatio: 0~10을 0~1로, 범위 밖은 자름', () => {
  assert.equal(traitRatio(0), 0);
  assert.equal(traitRatio(10), 1);
  assert.equal(traitRatio(5.5), 0.55);
  assert.equal(traitRatio(-3), 0);
  assert.equal(traitRatio(15), 1);
  assert.equal(traitRatio(Number.NaN), 0);
});

test('withAlpha: 알파를 두 자리 대문자 16진수로', () => {
  assert.equal(withAlpha('#F97316', 0), '#F9731600');
  assert.equal(withAlpha('#F97316', 0.15), '#F9731626');
  assert.equal(withAlpha('#F97316', 1), '#F97316FF');
  assert.equal(withAlpha('#F97316', 2), '#F97316FF');
  assert.equal(withAlpha('#F97316', -1), '#F9731600');
});

test('withAlpha: 잘못된 hex는 그대로', () => {
  assert.equal(withAlpha('red', 0.5), 'red');
  assert.equal(withAlpha('#FFF', 0.5), '#FFF');
  assert.equal(withAlpha('#F97316FF', 0.5), '#F97316FF');
  assert.equal(withAlpha('', 0.5), '');
});

test('sourceBadge', () => {
  assert.equal(sourceBadge('llm'), 'AI가 쓴 카드');
  assert.equal(sourceBadge('rule'), '기본 카드');
});
