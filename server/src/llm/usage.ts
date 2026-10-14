import { createHmac } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { llmIpUsage, llmUsage, members } from '../db/schema.js';
import { todayKst } from '../lib/time.js';

/** 오늘 LLM 호출 수를 1 올리고, 하루 상한 안이면 true (서버를 다시 켜도 초기화되지 않게 DB에 둠) */
export async function tryConsumeLlmCall(db: Db, dailyLimit: number, day = todayKst()): Promise<boolean> {
  const [row] = await db
    .insert(llmUsage)
    .values({ day, count: 1 })
    .onConflictDoUpdate({ target: llmUsage.day, set: { count: sql`${llmUsage.count} + 1` } })
    .returning({ count: llmUsage.count });
  return row.count <= dailyLimit;
}

/** 구성원의 AI 카드 횟수를 1 올리고, 상한 안이면 true (한 번의 UPDATE라 동시에 여러 번 제출해도 상한을 넘지 않음) */
export async function reserveLlmCard(db: Db, memberId: string, perMember: number): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ llmCards: sql`${members.llmCards} + 1` })
    .where(and(eq(members.id, memberId), lt(members.llmCards, perMember)))
    .returning({ id: members.id });
  return rows.length > 0;
}

/** LLM을 부르지 못했거나 실패하면 올린 횟수를 되돌림 (실제로 만든 AI 카드만 셈) */
export async function releaseLlmCard(db: Db, memberId: string): Promise<void> {
  await db
    .update(members)
    .set({ llmCards: sql`${members.llmCards} - 1` })
    .where(and(eq(members.id, memberId), gt(members.llmCards, 0)));
}

/** IP를 저장용 값으로 바꿈 (비밀값을 섞은 HMAC이라 저장된 값으로 IP를 되찾을 수 없음) */
export const ipKey = (ip: string, secret: string) => createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);

/** 이 IP의 오늘 AI 작업 횟수를 1 올리고, 상한 안이면 true (한 번의 INSERT … ON CONFLICT라 동시 요청에도 넘지 않음) */
export async function reserveIpLlm(db: Db, key: string, perDay: number, day = todayKst()): Promise<boolean> {
  const rows = await db
    .insert(llmIpUsage)
    .values({ day, ipHash: key, count: 1 })
    .onConflictDoUpdate({
      target: [llmIpUsage.day, llmIpUsage.ipHash],
      set: { count: sql`${llmIpUsage.count} + 1` },
      setWhere: sql`${llmIpUsage.count} < ${perDay}`,
    })
    .returning({ count: llmIpUsage.count });
  return rows.length > 0;
}

/** LLM을 부르지 못했거나 실패하면 이 IP의 오늘 횟수를 되돌림 */
export async function releaseIpLlm(db: Db, key: string, day = todayKst()): Promise<void> {
  await db
    .update(llmIpUsage)
    .set({ count: sql`${llmIpUsage.count} - 1` })
    .where(and(eq(llmIpUsage.day, day), eq(llmIpUsage.ipHash, key), gt(llmIpUsage.count, 0)));
}
