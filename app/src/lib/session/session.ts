import type { SessionResponse } from '../persona/types.ts';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type Session = {
  token: string;
  tripId: string;
  inviteCode: string;
  memberId: string;
  nickname: string;
};

export type SessionStore = {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
  getSession(): Session | null;
  getToken(): string | null;
  /** 세션이 바뀔 때(불러오기·저장·삭제) 부른다. 해제 함수를 돌려준다. */
  subscribe(listener: () => void): () => void;
};

const STORAGE_KEY = 'journey.session.v1';

/** 저장된 값 하나가 세션 모양이면 세션으로, 아니면 null. 여분 필드는 버린다. */
export function toSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const { token, tripId, inviteCode, memberId, nickname } = o;
  if (
    typeof token !== 'string' ||
    typeof tripId !== 'string' ||
    typeof inviteCode !== 'string' ||
    typeof memberId !== 'string' ||
    typeof nickname !== 'string'
  ) {
    return null;
  }
  return { token, tripId, inviteCode, memberId, nickname };
}

function parseSession(raw: string | null): Session | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return toSession(value);
}

export function createSessionStore(kv: KeyValueStore): SessionStore {
  let cache: Session | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    async load() {
      cache = parseSession(await kv.getItem(STORAGE_KEY));
      notify();
      return cache;
    },
    async save(session) {
      await kv.setItem(STORAGE_KEY, JSON.stringify(session));
      cache = session;
      notify();
    },
    async clear() {
      cache = null;
      notify();
      await kv.removeItem(STORAGE_KEY);
    },
    getSession: () => cache,
    getToken: () => cache?.token ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function fromSessionResponse(response: SessionResponse): Session {
  return {
    token: response.token,
    tripId: response.trip.id,
    inviteCode: response.trip.inviteCode,
    memberId: response.member.id,
    nickname: response.member.nickname,
  };
}
