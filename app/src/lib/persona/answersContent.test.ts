import test from 'node:test';
import assert from 'node:assert/strict';

import { hasContent, listDraft, setOther, setScale, setSingle, setText, setTexts, toggleOption } from './answers.ts';
import type { ListQuestion, MultiQuestion, ScaleQuestion, SingleQuestion, TextQuestion } from './types.ts';

const list: ListQuestion = { id: 'q16', order: 13, type: 'list', text: '가고 싶은 곳', required: false, maxItems: 3, maxLength: 30, placeholder: '' };
const single: SingleQuestion = { id: 'q17', order: 14, type: 'single', text: '속도', required: true, options: [{ id: 'pace_slow', text: '여유', emoji: '🐢' }] };
const dislikes: MultiQuestion = {
  id: 'q14',
  order: 15,
  type: 'multi',
  text: '싫은 것',
  minSelect: 0,
  maxSelect: 3,
  options: [{ id: 'dislike_walk', text: '오래 걷기', emoji: '🚶' }],
  other: { maxLength: 50, placeholder: '' },
};
const text: TextQuestion = { id: 'q15', order: 17, type: 'text', text: '추가 사항', required: false, maxLength: 200, placeholder: '' };
const scale: ScaleQuestion = { id: 'q1', order: 1, type: 'scale', text: '성향', min: 0, max: 10, minLabel: '', maxLabel: '' };

test('hasContent: 비어 있으면 false(화면 버튼이 "건너뛰기"), 무엇이든 넣으면 true', () => {
  assert.equal(hasContent(list, {}), false);
  assert.equal(hasContent(list, setTexts({}, list, ['', '  '])), false, '빈 칸만 있으면 비어 있음');
  assert.equal(hasContent(list, setTexts({}, list, ['감천문화마을'])), true);

  assert.equal(hasContent(dislikes, {}), false);
  assert.equal(hasContent(dislikes, toggleOption({}, dislikes, 'dislike_walk')), true);
  assert.equal(hasContent(dislikes, setOther({}, dislikes, '비 오는 날')), true, '기타만 적어도');
  assert.equal(hasContent(dislikes, setOther({}, dislikes, '  ')), false);

  assert.equal(hasContent(single, {}), false);
  assert.equal(hasContent(single, setSingle({}, single, 'pace_slow')), true);
  assert.equal(hasContent(text, setText({}, text, '  ')), false);
  assert.equal(hasContent(text, setText({}, text, '일찍 돌아가요')), true);
  assert.equal(hasContent(scale, setScale({}, scale, 0)), true);
});

test('listDraft: 입력 중인 빈 칸까지 그대로 돌려준다, 답이 없으면 빈 목록', () => {
  assert.deepEqual(listDraft({}, 'q16'), []);
  assert.deepEqual(listDraft(setTexts({}, list, ['감천', '']), 'q16'), ['감천', '']);
});
