import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../api/errors.ts';
import { createPlanBoardSync } from './boardSync.ts';
import type { RunResult, SyncClock } from './boardSync.ts';

const LOCKED = '다른 사람이 먼저 바꿨거나 지금은 고칠 수 없어요. 최신 일정을 다시 불러왔어요.';
const CLOSED = '이미 정해졌어요. 최신 상태를 다시 불러왔어요.';

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

type Timer = { at: number; fn: () => void };

function fakeClock() {
  let now = 0;
  let nextId = 1;
  let maxPending = 0;
  const delays: number[] = [];
  const timers = new Map<number, Timer>();
  const clock: SyncClock = {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      delays.push(ms);
      maxPending = Math.max(maxPending, timers.size);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  function tick(ms: number) {
    const end = now + ms;
    for (;;) {
      let next: [number, Timer] | undefined;
      for (const entry of timers) {
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  }
  return { clock, tick, delays, pending: () => timers.size, maxPending: () => maxPending };
}

type Call = { resolve(value: unknown): void; reject(error: unknown): void };

function deferred() {
  const calls: Call[] = [];
  let active = 0;
  let maxActive = 0;
  const fn = () =>
    new Promise<unknown>((resolve, reject) => {
      active++;
      maxActive = Math.max(maxActive, active);
      calls.push({
        resolve: (v) => {
          active--;
          resolve(v);
        },
        reject: (e) => {
          active--;
          reject(e);
        },
      });
    });
  return { fn, calls, maxActive: () => maxActive };
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

function setup(pollMs = 1000) {
  const time = fakeClock();
  const server = deferred();
  const sync = createPlanBoardSync({ clock: time.clock, fetchBoard: server.fn, pollMs });
  return { time, server, sync };
}

test('(g) start → loading → ready, 두 번째 start는 무시', async () => {
  const { server, sync } = setup();
  assert.deepEqual(sync.getState(), { board: null, phase: 'idle', busy: false, notice: null });
  sync.start();
  assert.equal(sync.getState().phase, 'loading');
  sync.start();
  assert.equal(server.calls.length, 1);
  server.calls[0].resolve(boardJson('choosing', 'm1'));
  await flush();
  const s = sync.getState();
  assert.equal(s.phase, 'ready');
  assert.equal(s.board?.meetingId, 'm1');
  assert.equal(s.board?.status, 'choosing');
  sync.start();
  assert.equal(server.calls.length, 1);
});

test('(h) 불러오기 중 refresh 세 번 → 끝난 뒤 정확히 한 번 더, 동시 불러오기는 하나', async () => {
  const { server, sync } = setup();
  sync.start();
  sync.refresh();
  sync.refresh();
  sync.refresh();
  assert.equal(server.calls.length, 1);
  server.calls[0].resolve(boardJson());
  await flush();
  assert.equal(server.calls.length, 2);
  server.calls[1].resolve(boardJson('revising', 'm2'));
  await flush();
  assert.equal(server.calls.length, 2);
  assert.equal(server.maxActive(), 1);
  assert.equal(sync.getState().board?.meetingId, 'm2');
});

test('(i) 폴링 간격·타이머 하나·refresh 시 취소·confirmed 뒤 중단', async () => {
  const { time, server, sync } = setup(500);
  sync.start();
  assert.equal(time.pending(), 0);
  server.calls[0].resolve(boardJson());
  await flush();
  assert.equal(time.pending(), 1);
  time.tick(499);
  assert.equal(server.calls.length, 1);
  time.tick(1);
  assert.equal(server.calls.length, 2);
  assert.equal(time.pending(), 0);

  server.calls[1].reject(new ApiError(0, 'NETWORK_ERROR', 'x'));
  await flush();
  assert.equal(time.pending(), 1);
  sync.refresh();
  assert.equal(time.pending(), 0);
  assert.equal(server.calls.length, 3);

  server.calls[2].resolve(boardJson('confirmed'));
  await flush();
  assert.equal(time.pending(), 0);
  time.tick(60_000);
  assert.equal(server.calls.length, 3);

  sync.refresh();
  assert.equal(server.calls.length, 4);
  server.calls[3].resolve(boardJson('confirmed', 'm4'));
  await flush();
  assert.equal(sync.getState().board?.meetingId, 'm4');
  assert.equal(time.pending(), 0);
  assert.equal(time.maxPending(), 1);
  assert.deepEqual(time.delays, [500, 500]);
});

test('(j) 불러오기 실패: waiting·error·board 유지·notice 불변·잘못된 형식', async () => {
  const { time, server, sync } = setup(100);
  sync.start();
  server.calls[0].reject(new ApiError(404, 'NOT_FOUND', '없음'));
  await flush();
  assert.deepEqual(sync.getState(), { board: null, phase: 'waiting', busy: false, notice: null });
  assert.equal(time.pending(), 1);

  time.tick(100);
  assert.equal(server.calls.length, 2);
  server.calls[1].reject(new Error('boom'));
  await flush();
  assert.equal(sync.getState().phase, 'error');

  time.tick(100);
  server.calls[2].resolve({ status: 'done' });
  await flush();
  assert.equal(sync.getState().phase, 'error');
  assert.equal(sync.getState().board, null);

  time.tick(100);
  server.calls[3].resolve(boardJson());
  await flush();
  const board = sync.getState().board;
  assert.ok(board);
  assert.equal(sync.getState().phase, 'ready');

  const action = deferred();
  const r = sync.run(action.fn);
  action.calls[0].reject(new ApiError(400, 'BAD_INPUT', '틀린 요청'));
  await r;
  assert.equal(sync.getState().notice, '틀린 요청');

  const fails: unknown[] = [new ApiError(404, 'NOT_FOUND', '없음'), new ApiError(0, 'NETWORK_ERROR', 'x'), { status: 'done' }];
  for (const fail of fails) {
    sync.refresh();
    const call = server.calls[server.calls.length - 1];
    if (fail instanceof ApiError) call.reject(fail);
    else call.resolve(fail);
    await flush();
    assert.deepEqual(sync.getState(), { board, phase: 'ready', busy: false, notice: '틀린 요청' });
  }
  assert.equal(sync.getState().board, board);
});

test('(k) run 성공과 busy', async () => {
  const { server, sync } = setup();
  sync.start();
  server.calls[0].resolve(boardJson('choosing', 'm1'));
  await flush();

  const action = deferred();
  const failed = sync.run(action.fn);
  action.calls[0].reject(new ApiError(500, 'INTERNAL_ERROR', '서버 오류'));
  await failed;
  assert.equal(sync.getState().notice, '서버 오류');

  const p = sync.run(action.fn);
  assert.equal(sync.getState().busy, true);
  assert.deepEqual(await sync.run(action.fn), { ok: false, code: 'BUSY' });
  assert.equal(action.calls.length, 2);

  const json = boardJson('voting', 'm2');
  action.calls[1].resolve(json);
  assert.deepEqual(await p, { ok: true, json });
  const s = sync.getState();
  assert.equal(s.board?.meetingId, 'm2');
  assert.equal(s.board?.status, 'voting');
  assert.equal(s.phase, 'ready');
  assert.equal(s.busy, false);
  assert.equal(s.notice, null);
});

test('(l) run 실패: notice 문구·다시 불러오기·code·clearNotice', async () => {
  const { time, server, sync } = setup();
  sync.start();
  server.calls[0].resolve(boardJson());
  await flush();

  const action = deferred();
  const runWith = (settle: (c: Call) => void) => {
    const p = sync.run(action.fn);
    settle(action.calls[action.calls.length - 1]);
    return p;
  };

  assert.deepEqual(await runWith((c) => c.reject(new ApiError(409, 'PLAN_LOCKED', '잠김'))), {
    ok: false,
    code: 'PLAN_LOCKED',
  });
  assert.equal(sync.getState().notice, LOCKED);
  assert.equal(sync.getState().busy, false);
  assert.equal(server.calls.length, 2);
  assert.equal(time.pending(), 0);
  server.calls[1].resolve(boardJson('voting', 'm2'));
  await flush();

  assert.deepEqual(await runWith((c) => c.reject(new ApiError(409, 'VOTE_CLOSED', '닫힘'))), {
    ok: false,
    code: 'VOTE_CLOSED',
  });
  assert.equal(sync.getState().notice, CLOSED);
  assert.equal(server.calls.length, 3);
  server.calls[2].resolve(boardJson('voting', 'm3'));
  await flush();
  const latest = sync.getState().board;
  assert.equal(latest?.meetingId, 'm3');

  assert.deepEqual(await runWith((c) => c.reject(new ApiError(400, 'BAD_INPUT', '입력이 틀렸어요'))), {
    ok: false,
    code: 'BAD_INPUT',
  });
  assert.equal(sync.getState().notice, '입력이 틀렸어요');

  assert.deepEqual(await runWith((c) => c.reject(new Error('x'))), { ok: false, code: 'UNKNOWN' });
  assert.equal(sync.getState().notice, '요청을 보내지 못했어요.');

  assert.deepEqual(await runWith((c) => c.resolve({ nope: true })), { ok: false, code: 'BAD_RESPONSE' });
  assert.equal(sync.getState().notice, '서버 응답을 읽을 수 없어요');
  assert.equal(sync.getState().board, latest);
  assert.equal(sync.getState().busy, false);
  assert.equal(server.calls.length, 3);

  sync.clearNotice();
  assert.equal(sync.getState().notice, null);
});

test('(m) 불러오기(1번) 중 run(2번)이 먼저 끝나면 늦은 board는 버려지고 폴링은 예약된다', async () => {
  const { time, server, sync } = setup();
  sync.start();
  const action = deferred();
  const p = sync.run(action.fn);
  const json = boardJson('revising', 'run');
  action.calls[0].resolve(json);
  assert.deepEqual(await p, { ok: true, json });
  assert.equal(sync.getState().board?.meetingId, 'run');
  assert.equal(sync.getState().phase, 'ready');

  server.calls[0].resolve(boardJson('choosing', 'old'));
  await flush();
  assert.equal(sync.getState().board?.meetingId, 'run');
  assert.equal(sync.getState().board?.status, 'revising');
  assert.equal(sync.getState().phase, 'ready');
  assert.equal(time.pending(), 1);
});

test('(n) dispose 뒤 결과 무반영·구독자 무호출·start/refresh 무시·run은 DISPOSED', async () => {
  const { time, server, sync } = setup();
  let notified = 0;
  sync.subscribe(() => notified++);
  sync.start();
  const action = deferred();
  const p = sync.run(action.fn);
  const before = { ...sync.getState() };
  const count = notified;

  sync.dispose();
  sync.dispose();
  const json = boardJson('revising', 'late');
  server.calls[0].resolve(boardJson());
  action.calls[0].resolve(json);
  assert.deepEqual(await p, { ok: true, json });
  await flush();

  assert.deepEqual(sync.getState(), before);
  assert.equal(notified, count);
  assert.equal(time.pending(), 0);
  sync.refresh();
  sync.start();
  time.tick(60_000);
  assert.equal(server.calls.length, 1);
  assert.deepEqual(await sync.run(action.fn), { ok: false, code: 'DISPOSED' });
  assert.equal(action.calls.length, 1);
});

test('(n) dispose는 걸린 폴링 타이머를 취소하고, 구독자 안 dispose도 안전하다', async () => {
  const a = setup();
  a.sync.start();
  a.server.calls[0].resolve(boardJson());
  await flush();
  assert.equal(a.time.pending(), 1);
  a.sync.dispose();
  assert.equal(a.time.pending(), 0);
  a.time.tick(60_000);
  assert.equal(a.server.calls.length, 1);

  const { time, server, sync } = setup();
  sync.start();
  server.calls[0].resolve(boardJson());
  await flush();
  let later = 0;
  sync.subscribe(() => sync.dispose());
  sync.subscribe(() => later++);
  sync.refresh();
  server.calls[1].resolve(boardJson('revising', 'm2'));
  await flush();
  assert.equal(later, 0);
  assert.equal(time.pending(), 0);
  time.tick(60_000);
  assert.equal(server.calls.length, 2);
});

test('구독자 안에서 refresh·run·자기 해제가 안전하다', async () => {
  const { server, sync } = setup();
  const action = deferred();
  let selfCalls = 0;
  const off = sync.subscribe(() => {
    selfCalls++;
    off();
  });
  let ran = false;
  let inner: Promise<RunResult> | undefined;
  sync.subscribe(() => {
    sync.refresh();
    if (!ran) {
      ran = true;
      inner = sync.run(action.fn);
    }
  });

  sync.start();
  assert.equal(selfCalls, 1);
  assert.equal(server.calls.length, 1);
  assert.equal(action.calls.length, 1);

  const json = boardJson('revising', 'r');
  action.calls[0].resolve(json);
  assert.deepEqual(await inner, { ok: true, json });
  assert.equal(sync.getState().board?.meetingId, 'r');

  server.calls[0].resolve(boardJson('choosing', 'old'));
  await flush();
  assert.equal(sync.getState().board?.meetingId, 'r');
  assert.equal(server.calls.length, 2);
  assert.equal(server.maxActive(), 1);
  assert.equal(selfCalls, 1);
  off();
});
