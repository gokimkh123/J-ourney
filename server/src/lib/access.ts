import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { ApiError } from './errors.js';
import { tunnelIp } from './rate-limit.js';

/**
 * 접근 키 (10/26 사용자 지시: 팀원 키를 넣으면 여행을 정해진 횟수만큼 실제 API로 짜고, 나머지 사람은 실제 API를 쓰지 못함)
 * 키 원문은 서버에 두지 않고 sha256만 ACCESS_KEYS에 둠. 키가 하나도 없으면 잠그지 않음 (예전과 같음)
 */
export const ACCESS = {
  /** 앱이 키를 보내는 요청 헤더 */
  header: 'x-access-key',
  /** 시험 화면(/dev)이 키를 기억하는 쿠키 (HttpOnly, /dev/key에서 넣음) */
  cookie: 'journey_key',
  cookieDays: 30,
  /** 이보다 긴 값은 키로 보지 않음 */
  keyMax: 200,
} as const;

/** 키 하나: 이름(회의 기록용) · 짤 수 있는 여행(회의 실행) 횟수 · 키의 sha256 */
export interface AccessKey {
  label: string;
  quota: number;
  hash: string;
}
/** 회의를 시작할 때 쓰는 키 몫 */
export type AccessGrant = Pick<AccessKey, 'label' | 'quota'>;
/** 요청의 접근: local = 서버 컴퓨터 안에서 보냄(포트 연결) · key = 맞는 키를 낸 터널 요청 · none = 키가 없거나 틀린 터널 요청 */
export type Access = { kind: 'local' } | ({ kind: 'key' } & AccessGrant) | { kind: 'none' };

export const hashAccessKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/** ACCESS_KEYS="이름:횟수:sha256(키),…" → 키 목록. 형식이 틀리면 서버를 켜지 않음 (키 값은 오류 문구에 넣지 않음) */
export function parseAccessKeys(raw: string | undefined): AccessKey[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((item) => {
    const m = /^([a-z0-9_-]{1,32}):(\d{1,6}):([0-9a-f]{64})$/i.exec(item.trim());
    if (!m) throw new Error('ACCESS_KEYS 형식이 틀림: 이름:횟수:sha256(키)를 쉼표로 이음');
    return { label: m[1], quota: Number(m[2]), hash: m[3].toLowerCase() };
  });
}

/** 낸 키에 맞는 항목 (같은 길이의 해시끼리 비교해 비교 시간으로 키를 알아낼 수 없게 함) */
export function matchKey(keys: readonly AccessKey[], raw: string | null | undefined): AccessKey | null {
  if (!raw || raw.length > ACCESS.keyMax) return null;
  const given = Buffer.from(hashAccessKey(raw.trim()), 'hex');
  return keys.find((k) => timingSafeEqual(Buffer.from(k.hash, 'hex'), given)) ?? null;
}

/** 낸 키: 헤더 → 쿠키 순서 */
export const presentedKey = (c: Context) => c.req.header(ACCESS.header) ?? getCookie(c, ACCESS.cookie) ?? null;

export function accessOf(c: Context, keys: readonly AccessKey[]): Access {
  if (!tunnelIp(c)) return { kind: 'local' };
  const k = matchKey(keys, presentedKey(c));
  return k ? { kind: 'key', label: k.label, quota: k.quota } : { kind: 'none' };
}

/**
 * 실제 API(외부 API·LLM)를 쓰는 요청의 키 몫: 키가 없는 서버이거나 서버 안에서 보낸 요청이면 undefined (키 횟수를 쓰지 않음)
 * 키가 있는 서버에 키 없이 들어온 터널 요청은 ACCESS_KEY_REQUIRED
 */
export function requireGrant(c: Context, keys: readonly AccessKey[]): AccessGrant | undefined {
  if (!keys.length) return undefined;
  const a = accessOf(c, keys);
  if (a.kind === 'none') throw new ApiError('ACCESS_KEY_REQUIRED', `이 서버에서 실제 API를 쓰려면 접근 키가 필요함 (앱: ${ACCESS.header} 헤더, 시험 화면: /dev/key)`);
  return a.kind === 'key' ? { label: a.label, quota: a.quota } : undefined;
}
