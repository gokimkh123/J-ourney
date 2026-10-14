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
};

const STORAGE_KEY = 'journey.session.v1';

function parseSession(raw: string | null): Session | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
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

export function createSessionStore(kv: KeyValueStore): SessionStore {
  let cache: Session | null = null;

  return {
    async load() {
      cache = parseSession(await kv.getItem(STORAGE_KEY));
      return cache;
    },
    async save(session) {
      await kv.setItem(STORAGE_KEY, JSON.stringify(session));
      cache = session;
    },
    async clear() {
      cache = null;
      await kv.removeItem(STORAGE_KEY);
    },
    getSession: () => cache,
    getToken: () => cache?.token ?? null,
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
