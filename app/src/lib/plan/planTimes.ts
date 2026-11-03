import type { KeyValueStore } from '../session/session.ts';

/**
 * 일정 탭에서 사람이 바꾼 시작 시각. 서버에는 시각표가 없어 이 폰에만 저장한다(11/3 결정: 다른 폰은 짐작한 시각을 본다).
 * 날(1부터) → 곳(chosenPlan.timeKeyOf) → 자정부터 분.
 */
export type DayTimes = Record<string, number>;
export type TripTimes = Record<number, DayTimes>;
/** 고치는 중인 시각. null은 "짐작한 시각으로 되돌리기" */
export type PendingTimes = Record<number, Record<string, number | null>>;

const DAY_MINUTES = 24 * 60;

/** "HH:MM" → 자정부터 분. 모양이 틀리면 null */
export function parseClock(text: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (m === null) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function withPending(pending: PendingTimes, day: number, key: string, minutes: number | null): PendingTimes {
  return { ...pending, [day]: { ...(pending[day] ?? {}), [key]: minutes } };
}

/** 저장된 시각 위에 고치는 중인 시각을 얹는다(null이면 뺀다). */
export function applyPending(times: TripTimes, pending: PendingTimes): TripTimes {
  const out: TripTimes = { ...times };
  for (const [dayText, keys] of Object.entries(pending)) {
    const day = Number(dayText);
    const next: DayTimes = { ...(out[day] ?? {}) };
    for (const [key, minutes] of Object.entries(keys)) {
      if (minutes === null) delete next[key];
      else next[key] = minutes;
    }
    if (Object.keys(next).length > 0) out[day] = next;
    else delete out[day];
  }
  return out;
}

/** 고치는 중인 시각 가운데 저장된 것과 실제로 달라지는 수 */
export function pendingCount(times: TripTimes, pending: PendingTimes): number {
  let count = 0;
  for (const [dayText, keys] of Object.entries(pending)) {
    for (const [key, minutes] of Object.entries(keys)) {
      if ((times[Number(dayText)]?.[key] ?? null) !== minutes) count += 1;
    }
  }
  return count;
}

export type PlanTimesStore = {
  load(): Promise<void>;
  /** 여행 id → 바꾼 시각 */
  get(): Record<string, TripTimes>;
  /** 여행 하나의 바꾼 시각을 통째로 바꾼다(비면 지운다). */
  save(tripId: string, times: TripTimes): Promise<void>;
  subscribe(listener: () => void): () => void;
};

const STORAGE_KEY = 'journey.planTimes.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 저장된 글을 읽는다. 모양이 틀린 칸은 버린다. */
function parseAll(raw: string | null): Record<string, TripTimes> {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(value)) return {};
  const out: Record<string, TripTimes> = {};
  for (const [tripId, days] of Object.entries(value)) {
    if (!isRecord(days)) continue;
    const trip: TripTimes = {};
    for (const [dayText, keys] of Object.entries(days)) {
      const day = Number(dayText);
      if (!Number.isInteger(day) || !isRecord(keys)) continue;
      const times: DayTimes = {};
      for (const [key, minutes] of Object.entries(keys)) {
        if (typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0 && minutes < DAY_MINUTES) times[key] = minutes;
      }
      if (Object.keys(times).length > 0) trip[day] = times;
    }
    if (Object.keys(trip).length > 0) out[tripId] = trip;
  }
  return out;
}

export function createPlanTimesStore(kv: KeyValueStore): PlanTimesStore {
  let cache: Record<string, TripTimes> = {};
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  };
  return {
    async load() {
      cache = parseAll(await kv.getItem(STORAGE_KEY));
      notify();
    },
    get: () => cache,
    // 메모리를 먼저 바꾸고 저장한다(다른 저장소와 같음). 저장이 실패해도 이번 실행 동안은 화면이 맞는다.
    async save(tripId, times) {
      const next = { ...cache };
      if (Object.keys(times).length > 0) next[tripId] = times;
      else delete next[tripId];
      cache = next;
      notify();
      await kv.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
