/** 카카오 로그인 토큰(usr_). 여행 구성원 토큰(tok_)과 따로 저장한다. */
export type Login = {
  token: string;
  /** 서버가 준 만료 시각(한국 시각 ISO, 예: 2026-12-02T21:00:00+09:00) */
  expiresAt: string;
};

/** 브라우저 로그인이 앱 주소로 돌아왔을 때 실어 오는 결과 */
export type LoginReturn =
  | { kind: 'ok'; login: Login }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string };

/**
 * 서버 로그인 시작 주소(명세 v2.6). 서버는 카카오 로그인을 마치면 returnTo(앱 주소)로 돌려보낸다.
 * returnTo는 journey://(APK)와 exp://(Expo Go, 시험 기간에만)만 받는다. 다른 주소는 400.
 */
export function kakaoStartUrl(apiBaseUrl: string, returnTo: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/api/v1/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`;
}

function queryOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.indexOf('?');
  if (q === -1) return out;
  const hash = url.indexOf('#', q);
  const raw = url.slice(q + 1, hash === -1 ? undefined : hash);
  for (const pair of raw.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 돌아온 앱 주소에서 로그인 결과를 읽는다(명세 v2.6). 성공: token(usr_)·userId·expiresAt.
 * 실패: error = LOGIN_CANCELLED(카카오 동의 화면에서 취소) | UNAUTHORIZED | LOGIN_UNAVAILABLE. 토큰도 오류도 없으면 unknown.
 */
export function parseLoginReturn(url: string): LoginReturn {
  const q = queryOf(url);
  if (q.error !== undefined) return q.error === 'LOGIN_CANCELLED' ? { kind: 'cancelled' } : { kind: 'error', code: q.error || 'unknown' };
  const token = q.token ?? '';
  const expiresAt = q.expiresAt ?? '';
  if (!token.startsWith('usr_') || Number.isNaN(Date.parse(expiresAt))) return { kind: 'error', code: 'unknown' };
  return { kind: 'ok', login: { token, expiresAt } };
}

/** 만료됐으면 true. 만료 시각을 읽을 수 없어도 true(다시 로그인). */
export function isExpired(login: Login, now: number = Date.now()): boolean {
  const at = Date.parse(login.expiresAt);
  return Number.isNaN(at) || at <= now;
}

/** 저장된 값이 로그인 모양이면 Login, 아니면 null */
export function toLogin(value: unknown): Login | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { token, expiresAt } = value as Record<string, unknown>;
  if (typeof token !== 'string' || !token.startsWith('usr_') || typeof expiresAt !== 'string') return null;
  return { token, expiresAt };
}

/** 로그인 실패 코드를 화면 문장으로 */
export function loginErrorText(code: string): string {
  if (code === 'UNAUTHORIZED') return '카카오 로그인을 확인하지 못했어요. 다시 시도해 주세요.';
  if (code === 'LOGIN_UNAVAILABLE') return '지금은 카카오 로그인을 할 수 없어요. 잠시 뒤 다시 시도해 주세요.';
  return '로그인하지 못했어요. 다시 시도해 주세요.';
}

/** 내 여행 목록(GET /users/me/trips)에서 여행 id만 읽는다. 모양이 다른 항목은 건너뛴다. */
export function parseMyTripIds(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return [];
  const trips = (json as { trips?: unknown }).trips;
  if (!Array.isArray(trips)) return [];
  const ids: string[] = [];
  for (const item of trips) {
    const id = (item as { trip?: { id?: unknown } } | null)?.trip?.id;
    if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
