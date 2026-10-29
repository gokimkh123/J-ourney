import { ApiError } from '../api/errors.ts';
import { parsePlanBoard } from './board.ts';
import type { PlanBoard } from './board.ts';

export type SyncClock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type BoardSyncState = {
  board: PlanBoard | null;
  phase: 'idle' | 'loading' | 'waiting' | 'ready' | 'error';
  busy: boolean;
  notice: string | null;
};

export type RunResult = { ok: true; json: unknown } | { ok: false; code: string };

export type BoardSync = {
  getState(): BoardSyncState;
  subscribe(fn: () => void): () => void;
  start(): void;
  refresh(): void;
  run(action: () => Promise<unknown>): Promise<RunResult>;
  clearNotice(): void;
  dispose(): void;
};

const LOCKED_NOTICE = '다른 사람이 먼저 바꿨거나 지금은 고칠 수 없어요. 최신 일정을 다시 불러왔어요.';
const CLOSED_NOTICE = '이미 정해졌어요. 최신 상태를 다시 불러왔어요.';
const SEND_FAILED_NOTICE = '요청을 보내지 못했어요.';

type Attempt = { ok: true; json: unknown; board: PlanBoard } | { ok: false; error: unknown };

async function attempt(call: () => Promise<unknown>): Promise<Attempt> {
  try {
    const json = await call();
    return { ok: true, json, board: parsePlanBoard(json) };
  } catch (error) {
    return { ok: false, error };
  }
}

function errorCode(e: unknown): string {
  return e instanceof ApiError ? e.code : 'UNKNOWN';
}

type Listener = { fn: () => void; active: boolean };

export function createPlanBoardSync(options: {
  clock: SyncClock;
  fetchBoard: () => Promise<unknown>;
  pollMs: number;
}): BoardSync {
  const { clock, fetchBoard, pollMs } = options;
  let state: BoardSyncState = { board: null, phase: 'idle', busy: false, notice: null };
  let listeners: Listener[] = [];
  let started = false;
  let disposed = false;
  let loading = false;
  let reloadQueued = false;
  let pollTimer: { handle: unknown } | null = null;
  let lastRequest = 0;
  let appliedRequest = 0;

  function setState(patch: Partial<BoardSyncState>): void {
    if (disposed) return;
    const next = { ...state, ...patch };
    if (
      next.board === state.board &&
      next.phase === state.phase &&
      next.busy === state.busy &&
      next.notice === state.notice
    ) {
      return;
    }
    state = next;
    for (const l of listeners.slice()) {
      if (disposed) return;
      if (l.active) l.fn();
    }
  }

  function clearPoll(): void {
    if (pollTimer === null) return;
    clock.clearTimeout(pollTimer.handle);
    pollTimer = null;
  }

  function schedulePoll(): void {
    clearPoll();
    if (disposed || state.board?.status === 'confirmed') return;
    pollTimer = {
      handle: clock.setTimeout(() => {
        pollTimer = null;
        if (!loading) refresh();
      }, pollMs),
    };
  }

  function refresh(): void {
    if (disposed) return;
    if (loading) {
      reloadQueued = true;
      return;
    }
    void load();
  }

  async function load(): Promise<void> {
    loading = true;
    clearPoll();
    const request = ++lastRequest;
    const r = await attempt(fetchBoard);
    if (disposed) return;
    if (request > appliedRequest) {
      if (r.ok) {
        appliedRequest = request;
        setState({ board: r.board, phase: 'ready' });
      } else if (state.board === null) {
        setState({ phase: errorCode(r.error) === 'NOT_FOUND' ? 'waiting' : 'error' });
      }
    }
    loading = false;
    if (reloadQueued) {
      reloadQueued = false;
      refresh();
    } else {
      schedulePoll();
    }
  }

  async function run(action: () => Promise<unknown>): Promise<RunResult> {
    if (disposed) return { ok: false, code: 'DISPOSED' };
    if (state.busy) return { ok: false, code: 'BUSY' };
    const request = ++lastRequest;
    setState({ busy: true });
    if (disposed) return { ok: false, code: 'DISPOSED' };
    const r = await attempt(action);
    if (!r.ok) {
      const code = errorCode(r.error);
      if (code === 'PLAN_LOCKED' || code === 'VOTE_CLOSED') {
        setState({ busy: false, notice: code === 'PLAN_LOCKED' ? LOCKED_NOTICE : CLOSED_NOTICE });
        refresh();
      } else {
        setState({ busy: false, notice: r.error instanceof ApiError ? r.error.message : SEND_FAILED_NOTICE });
      }
      return { ok: false, code };
    }
    if (request > appliedRequest) {
      appliedRequest = request;
      setState({ board: r.board, phase: 'ready', busy: false, notice: null });
    } else {
      setState({ busy: false, notice: null });
    }
    if (state.board?.status === 'confirmed') clearPoll();
    return { ok: true, json: r.json };
  }

  return {
    getState: () => state,
    subscribe(fn) {
      const l: Listener = { fn, active: true };
      listeners.push(l);
      return () => {
        l.active = false;
        listeners = listeners.filter((x) => x !== l);
      };
    },
    start() {
      if (disposed || started) return;
      started = true;
      if (state.board === null) setState({ phase: 'loading' });
      refresh();
    },
    refresh,
    run,
    clearNotice() {
      setState({ notice: null });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPoll();
      for (const l of listeners) l.active = false;
      listeners = [];
    },
  };
}
