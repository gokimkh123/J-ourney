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
export const AUTH = { sessionDays: 30, tokenPrefix: 'usr_' } as const;

export type User = typeof users.$inferSelect;

/** 카카오 로그인 토큰 확인기: 앱이 카카오 SDK로 받은 사용자 토큰을 카카오에 물어 회원번호·앱 ID를 받음. 토큰은 저장하지 않음 */
export interface KakaoAuth {
  /** 맞는 토큰이면 회원번호·앱 ID, 만료·잘못된 토큰이면 null. 카카오에 묻지 못하면 오류 */
  verify(accessToken: string): Promise<{ kakaoId: string; appId: string } | null>;
}

/** 카카오 '토큰 정보 보기' API로 확인 (앱 키 없이 사용자 토큰만으로 물음, 무료) */
export function kakaoAuthClient(opts: { apiBase: string; timeoutMs: number }): KakaoAuth {
  return {
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
