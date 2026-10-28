import { toSession } from './session.ts';
import type { KeyValueStore, Session, SessionStore } from './session.ts';

/**
 * 이 폰이 참여 중인 파티(여행) 목록. 여러 파티에 동시에 들어가 있을 수 있다.
 * 지금 들어가 있는 파티 하나는 session(SessionStore)이 따로 들고 있고, 여기는 "내 파티 목록"만 맡는다.
 */
export type PartyBook = {
  load(): Promise<Session[]>;
  /** 바뀔 때만 새 배열을 돌려준다(useSyncExternalStore용). 처음 참여한 파티가 앞에 온다. */
  list(): Session[];
  /** 같은 여행(tripId)이면 덮어쓰고, 새 여행이면 맨 앞에 넣는다. */
  add(session: Session): Promise<void>;
  remove(tripId: string): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: () => void): () => void;
};

const STORAGE_KEY = 'journey.parties.v1';

function parseParties(raw: string | null): Session[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Session[] = [];
  for (const item of value) {
    const s = toSession(item);
    if (s === null || seen.has(s.tripId)) continue;
    seen.add(s.tripId);
    out.push(s);
  }
  return out;
}

export function createPartyBook(kv: KeyValueStore): PartyBook {
  let cache: Session[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener();
    }
  };
  // 메모리를 먼저 바꾸고 저장한다. 저장이 실패해도 이번 실행 동안은 화면이 맞는다.
  const commit = async (next: Session[]) => {
    cache = next;
    notify();
    if (next.length === 0) await kv.removeItem(STORAGE_KEY);
    else await kv.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  return {
    async load() {
      cache = parseParties(await kv.getItem(STORAGE_KEY));
      notify();
      return cache;
    },
    list: () => cache,
    async add(session) {
      const at = cache.findIndex((p) => p.tripId === session.tripId);
      const next = at === -1 ? [session, ...cache] : cache.map((p, i) => (i === at ? session : p));
      await commit(next);
    },
    async remove(tripId) {
      if (!cache.some((p) => p.tripId === tripId)) return;
      await commit(cache.filter((p) => p.tripId !== tripId));
    },
    clear: () => commit([]),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 파티 사이를 오가는 동작. 지금 들어간 파티는 session, 목록은 parties가 맡는다. */
export function createPartyActions(session: SessionStore, parties: PartyBook) {
  return {
    /** 새로 만들었거나 초대 코드로 들어간 파티: 목록에 넣고 그 파티로 들어간다. */
    async join(s: Session): Promise<void> {
      await parties.add(s);
      await session.save(s);
    },
    /** 목록에 있는 파티로 들어간다. 목록에 없으면 false. */
    async enter(tripId: string): Promise<boolean> {
      const found = parties.list().find((p) => p.tripId === tripId);
      if (found === undefined) return false;
      await session.save(found);
      return true;
    },
    /** 파티에서 나와 초기 화면(파티 목록)으로. 파티는 목록에 남는다. */
    async exit(): Promise<void> {
      await session.clear();
    },
    /** 파티를 목록에서 지운다(이 폰에서만). 지금 들어가 있던 파티면 초기 화면으로 나온다. */
    async leave(tripId: string): Promise<void> {
      const wasActive = session.getSession()?.tripId === tripId;
      await parties.remove(tripId);
      if (wasActive) await session.clear();
    },
  };
}
