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
  /** 시연 모드로 만든 파티(내가 방장). 서버는 알려 주지 않아 만들 때 폰에 적어 둔다. */
  demo?: boolean;
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
  return { token, tripId, inviteCode, memberId, nickname, ...(o.demo === true && { demo: true }) };
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
    // 메모리를 먼저 바꾸고 저장한다(파티 목록·성향·로그인 저장소와 같음). 저장이 끝나기 전에 나가기(clear)를 해도
    // 늦게 끝난 저장이 세션을 되살리지 않는다.
    async save(session) {
      cache = session;
      notify();
      await kv.setItem(STORAGE_KEY, JSON.stringify(session));
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
