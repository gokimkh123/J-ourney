import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { userSessions, users } from '../db/schema.js';
import { hashToken } from './ids.js';

/**
 * 카카오 로그인 규칙 값 (11/2)
 * sessionDays: 로그인 토큰을 쓰는 기간. 시연·여행 기간(며칠–몇 주) 동안 다시 로그인하지 않게 하되, 잃어버린 기기의 토큰이 계속 살지 않게 상한
 * tokenPrefix: 로그인 토큰의 앞머리 (구성원 토큰 tok_와 나눠, 여행 만들기·참여에 구성원 토큰을 보내도 로그인으로 잘못 읽지 않게)
 */
export const AUTH = {
  sessionDays: 30,
  tokenPrefix: 'usr_',
  /** 브라우저 로그인 (11/2): 카카오 로그인 창을 연 뒤 콜백으로 돌아오기까지 기다리는 시간 (계정 입력·동의에 넉넉히) */
  stateTtlMs: 10 * 60_000,
  /** 콜백을 기다리는 브라우저 로그인 수 상한. 시작 주소는 GET이라 쓰기 횟수 제한을 받지 않으므로, 넘으면 가장 오래된 것부터 버려 메모리가 계속 늘지 않게 함 */
  maxPendingLogins: 1000,
  /** 로그인 뒤 돌아갈 앱 주소(returnTo) 길이 상한 */
  returnToMax: 512,
} as const;

export type User = typeof users.$inferSelect;

/** 카카오 로그인 토큰 확인기: 앱이 카카오 SDK로 받은 사용자 토큰을 카카오에 물어 회원번호·앱 ID를 받음. 토큰은 저장하지 않음 */
export interface KakaoAuth {
  /** 맞는 토큰이면 회원번호·앱 ID, 만료·잘못된 토큰이면 null. 카카오에 묻지 못하면 오류 */
  verify(accessToken: string): Promise<{ kakaoId: string; appId: string } | null>;
  /** 브라우저 로그인 (11/2): 카카오 로그인 창 주소. REST API 키·리다이렉트 URI가 설정된 서버에만 있음 */
  authorizeUrl?(state: string): string;
  /** 브라우저 로그인: 카카오가 콜백으로 돌려준 인가 코드 → 카카오 액세스 토큰. 지났거나 잘못된 코드면 null, 카카오에 묻지 못하면 오류 */
  exchange?(code: string): Promise<string | null>;
}

/** 브라우저 로그인 설정: REST API 키는 서버에만 두고, 카카오 로그인 창 주소와 토큰 발급은 서버가 만듦 */
export interface KakaoBrowserLogin {
  /** 카카오 로그인 창·토큰 발급 주소 (KAKAO_AUTH_BASE) */
  authBase: string;
  restKey: string;
  /** 카카오 콘솔(REST API 키)에 등록한 리다이렉트 URI와 글자까지 같은 값 */
  redirectUri: string;
  /** 콘솔에서 클라이언트 시크릿을 켰을 때만 */
  clientSecret: string | null;
}

/** 카카오 '토큰 정보 보기' API로 확인 (앱 키 없이 사용자 토큰만으로 물음, 무료) */
export function kakaoAuthClient(opts: { apiBase: string; timeoutMs: number; browser?: KakaoBrowserLogin | null }): KakaoAuth {
  const client: KakaoAuth = {
    async verify(accessToken) {
      const res = await fetch(`${opts.apiBase}/v1/user/access_token_info`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      // 400·401: 만료되었거나 잘못된 토큰 (카카오 오류 코드 -401·-2)
      if (res.status === 400 || res.status === 401) return null;
      if (!res.ok) throw new Error(`카카오 토큰 확인 응답 ${res.status}`);
      const body = (await res.json()) as { id?: number | string; app_id?: number | string };
      if (body.id === undefined || body.app_id === undefined) return null;
      return { kakaoId: String(body.id), appId: String(body.app_id) };
    },
  };
  const b = opts.browser;
  if (b) {
    client.authorizeUrl = (state) =>
      `${b.authBase}/oauth/authorize?${new URLSearchParams({ client_id: b.restKey, redirect_uri: b.redirectUri, response_type: 'code', state })}`;
    client.exchange = async (code) => {
      const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: b.restKey, redirect_uri: b.redirectUri, code });
      if (b.clientSecret) form.set('client_secret', b.clientSecret);
      const res = await fetch(`${b.authBase}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      // 400·401: 지났거나 이미 쓴 인가 코드, 콘솔의 리다이렉트 URI·클라이언트 시크릿과 다름 → 카카오 오류 코드(KOE…)만 남김 (키·코드는 남기지 않음)
      if (res.status === 400 || res.status === 401) {
        const err = (await res.json().catch(() => null)) as { error_code?: string } | null;
        console.warn('카카오 인가 코드 교환 거절:', err?.error_code ?? res.status);
        return null;
      }
      if (!res.ok) throw new Error(`카카오 토큰 발급 응답 ${res.status}`);
      const body = (await res.json()) as { access_token?: string };
      return body.access_token ?? null;
    };
  }
  return client;
}

/** Authorization: Bearer 값 중 로그인 토큰(usr_)만 (구성원 토큰은 무시) */
export const userTokenOf = (c: Context): string | null => {
  const token = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '')?.[1] ?? null;
  return token?.startsWith(AUTH.tokenPrefix) ? token : null;
};

/** 로그인 토큰의 계정 (없거나 만료면 null) */
export async function userOfToken(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(and(eq(userSessions.tokenHash, hashToken(token)), gt(userSessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}
