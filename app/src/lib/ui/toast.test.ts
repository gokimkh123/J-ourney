import assert from 'node:assert/strict';
import test from 'node:test';

import { showToast, toastStore } from './toast.ts';

test('알림을 띄울 때마다 새 id라서 같은 글도 다시 보인다', () => {
  showToast('파티를 없앴어요');
  const first = toastStore.get();
  showToast('파티를 없앴어요');
  const second = toastStore.get();
  assert.equal(first?.text, '파티를 없앴어요');
  assert.equal(second?.text, '파티를 없앴어요');
  assert.ok(second!.id > first!.id);
});
