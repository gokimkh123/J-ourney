import test from 'node:test';
import assert from 'node:assert/strict';

import { extractInviteCode, inviteShareText } from './format.ts';

test('초대 메시지를 통째로 붙여 넣어도 코드만 고른다', () => {
  assert.equal(extractInviteCode(inviteShareText('부산 1박 2일', 'BSN482'), 6), 'BSN482');
  // 예전 공유 글(문장 가운데 코드)
  assert.equal(extractInviteCode('부산 1박 2일 여행에 초대해요! 여행회의 앱에서 초대 코드 BSN482를 넣어 주세요.', 6), 'BSN482');
  // 제목에 코드처럼 생긴 영어 낱말이 있어도 끝에 둔 코드를 고른다.
  assert.equal(extractInviteCode(inviteShareText('BUSANZ 맛집', 'K7QW2X'), 6), 'K7QW2X');
});

test('손으로 넣는 중이면 지금처럼 다듬어 길이만큼 둔다', () => {
  assert.equal(extractInviteCode('bsn4', 6), 'BSN4');
  assert.equal(extractInviteCode('bsn-482', 6), 'BSN482');
  // 한 글자 더 치면 넘친 글자는 버린다.
  assert.equal(extractInviteCode('BSN4827', 6), 'BSN482');
  // 서버 코드에 없는 글자(0·O·1·I)가 섞이면 고르지 않고 다듬기만 한다.
  assert.equal(extractInviteCode('ABC0EF', 6), 'ABC0EF');
});

test('공유 글은 코드를 맨 끝 줄에 따로 둔다', () => {
  const text = inviteShareText(null, 'BSN482');
  assert.ok(text.startsWith('여행에 초대해요!'));
  assert.ok(text.endsWith('\n\nBSN482'));
  assert.ok(inviteShareText('부산', 'BSN482').startsWith('부산 여행에 초대해요!'));
});
