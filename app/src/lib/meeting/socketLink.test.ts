import assert from 'node:assert/strict';
import test from 'node:test';

import { linkSocket } from './socketLink.ts';

function setup() {
  const calls: string[] = [];
  let closes = 0;
  const link = linkSocket(
    {
      close() {
        closes += 1;
      },
    },
    {
      open: () => calls.push('open'),
      message: (text) => calls.push(`message:${text}`),
      close: (code, reason) => calls.push(`close:${code}:${reason}`),
    },
  );
  return { link, calls, closes: () => closes };
}

test('열리고 받고 닫히는 것을 그대로 넘긴다', () => {
  const { link, calls } = setup();
  link.opened();
  link.received('a');
  link.closed(1006, 'gone');
  assert.deepEqual(calls, ['open', 'message:a', 'close:1006:gone']);
});

test('연결 중에 닫았는데 나중에 열리면(안드로이드) 그 자리에서 다시 닫고 열림을 넘기지 않는다', () => {
  const { link, calls, closes } = setup();
  link.close();
  assert.equal(closes(), 1);
  link.opened();
  assert.equal(closes(), 2);
  link.received('late');
  assert.deepEqual(calls, []);
});

test('이쪽에서 닫은 뒤에 온 글과 닫힘은 넘기지 않는다', () => {
  const { link, calls } = setup();
  link.opened();
  link.close();
  link.received('late');
  link.closed(1000, '');
  assert.deepEqual(calls, ['open']);
});

test('서버가 닫으면 닫힘을 한 번만 넘기고 그 뒤 콜백은 무시한다', () => {
  const { link, calls } = setup();
  link.opened();
  link.closed(4000, 'replaced');
  link.received('late');
  link.closed(1006, '');
  assert.deepEqual(calls, ['open', 'close:4000:replaced']);
});
