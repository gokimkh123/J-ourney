import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlanBoardSync } from './boardSync.ts';
import type { SyncClock } from './boardSync.ts';

function boardJson(status = 'revising', meetingId = 'mtg_1') {
  return {
    status,
    meetingId,
    candidates: [],
    choice: { votes: [], answered: 0, total: 0, chosen: null },
    plan: null,
    edits: [],
    confirm: null,
    confirmedAt: null,
  };
}

// 폴링 타이머를 손으로 부르는 시계
function manualClock() {
  const timers: (() => void)[] = [];
  const clock: SyncClock = {
    setTimeout(fn) {
      timers.push(fn);
      return timers.length - 1;
    },
    clearTimeout() {},
  };
  return { clock, fire: () => timers.shift()?.() };
}

function server() {
  const replies: ((value: unknown) => void)[] = [];
  const fn = () => new Promise<unknown>((resolve) => replies.push(resolve));
  return { fn, reply: (value: unknown) => replies.shift()?.(value), pending: () => replies.length };
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

test('폴링이 같은 응답을 받으면 board를 그대로 두고 구독자를 부르지 않는다', async () => {
  const time = manualClock();
  const api = server();
  const sync = createPlanBoardSync({ clock: time.clock, fetchBoard: api.fn, pollMs: 5000 });
  sync.start();
  api.reply(boardJson('revising', 'm1'));
  await flush();
  const first = sync.getState().board;
  assert.ok(first);

  let notified = 0;
  sync.subscribe(() => notified++);
  time.fire();
  api.reply(boardJson('revising', 'm1'));
  await flush();
  assert.equal(sync.getState().board, first);
  assert.equal(notified, 0);

  // 내용이 바뀌면 새 board로 바꾸고 알린다.
  time.fire();
  api.reply(boardJson('revising', 'm2'));
  await flush();
  assert.notEqual(sync.getState().board, first);
  assert.equal(sync.getState().board?.meetingId, 'm2');
  assert.equal(notified, 1);
  sync.dispose();
});

test('고치기 응답이 지금 board와 같으면 board는 그대로 두고 busy만 푼다', async () => {
  const time = manualClock();
  const api = server();
  const sync = createPlanBoardSync({ clock: time.clock, fetchBoard: api.fn, pollMs: 5000 });
  sync.start();
  api.reply(boardJson('choosing', 'm1'));
  await flush();
  const first = sync.getState().board;

  const result = await sync.run(async () => boardJson('choosing', 'm1'));
  assert.equal(result.ok, true);
  assert.equal(sync.getState().board, first);
  assert.equal(sync.getState().busy, false);

  const changed = await sync.run(async () => boardJson('voting', 'm1'));
  assert.equal(changed.ok, true);
  assert.equal(sync.getState().board?.status, 'voting');
  sync.dispose();
});
