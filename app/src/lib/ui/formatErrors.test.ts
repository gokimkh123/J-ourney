import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api/errors.ts';
import { describeError } from './format.ts';

const err = (code: string, status = 409) => new ApiError(status, code, '서버 원문');

test('MEETING_IN_PROGRESS는 어디서 났는지에 따라 문구가 다르다', () => {
  assert.match(describeError(err('MEETING_IN_PROGRESS')), /성향을 바꿀 수 없/);
  assert.match(describeError(err('MEETING_IN_PROGRESS'), 'join'), /참여할 수 없/);
  assert.match(describeError(err('MEETING_IN_PROGRESS'), 'meeting'), /진행 중/);
});

test('새 서버 오류 코드는 쉬운 말로 바뀐다', () => {
  for (const code of ['ACCESS_KEY_REQUIRED', 'ACCESS_QUOTA_EXCEEDED', 'MEETING_LIMIT', 'NOT_ENOUGH_MEMBERS', 'PERSONA_REQUIRED', 'REVIEW_CLOSED', 'PAYLOAD_TOO_LARGE']) {
    const text = describeError(err(code));
    assert.notEqual(text, '서버 원문', code);
    assert.ok(text.length > 5, code);
  }
});

test('모르는 코드는 서버 문구 그대로', () => {
  assert.equal(describeError(err('SOMETHING_ELSE', 400)), '서버 원문');
});
