import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { Db } from '../db/client.js';
import { members } from '../db/schema.js';
import { ApiError } from './errors.js';
import { hashToken } from './ids.js';

export type Member = typeof members.$inferSelect;
export type AuthEnv = { Variables: { member: Member } };

/** Authorization: Bearer {token}으로 구성원을 확인함 (명세서 3장 인증) */
export const requireMember = (db: Db) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const token = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
    if (!token) throw new ApiError('UNAUTHORIZED', '인증 토큰이 필요함');
    const [member] = await db.select().from(members).where(eq(members.tokenHash, hashToken(token))).limit(1);
    if (!member) throw new ApiError('UNAUTHORIZED', '유효하지 않은 토큰임');
    c.set('member', member);
    await next();
  });
