import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client.js';
import { llmRecords } from '../db/schema.js';
import { stableJson } from '../lib/stable.js';
import type { JsonRequest } from './client.js';

/**
 * LLM 녹화·재생 모드 (10/19 사용자 요청: 시험에서 나온 답을 저장해 두었다가 API 호출 없이 다시 시험)
 * off: 녹화된 답을 다시 쓰지 않음 · only: 녹화된 답만 쓰고 LLM은 부르지 않음 (LLM_REPLAY=true) · fill: 녹화된 답은 쓰고 없는 요청만 LLM을 부름 (LLM_REPLAY=fill)
 */
export type ReplayMode = 'off' | 'only' | 'fill';

export interface LlmRecorder {
  readonly mode: ReplayMode;
  /** 같은 요청의 녹화된 답 (off이거나 없으면 null). 다시 쓴 답은 LLM 횟수에 세지 않으므로 부르는 쪽이 횟수를 잡기 전에 확인함 */
  replay<T extends z.ZodType>(req: JsonRequest<T>, attempt?: number): Promise<z.infer<T> | null>;
  /** 실제로 부른 답을 녹화함 (모드와 상관없이, 같은 지문이 이미 있으면 그대로 둠) */
  record<T extends z.ZodType>(req: JsonRequest<T>, value: z.infer<T>, attempt?: number): Promise<void>;
}

/**
 * 요청 지문 = 모델 이름 + 용도(schemaName) + 지시문 + 입력 + 몇 번째 시도 (하나라도 다르면 다른 요청)
 * 시도 번호를 넣는 까닭: 형식이 틀려 같은 요청을 1번 더 부를 때 첫 답을 다시 받지 않게 함
 * 주의: 생각 세기(thinking)는 지문에 넣지 않음 → 생각 세기를 바꿔 비교할 때는 schemaName도 바꿀 것 (10/19 비교 시험도 이름을 달리함)
 * 주의: model은 예비 모델까지 이은 이름(기본 → 예비)이라 LLM_FALLBACKS를 바꾸면 기존 녹화와 맞지 않음, LLM을 하나도 열지 못하면 'none'
 */
export function llmRecorder(db: Db, model: string, mode: ReplayMode): LlmRecorder {
  const keyOf = (req: JsonRequest<z.ZodType>, attempt: number) =>
    createHash('sha256').update(stableJson({ model, purpose: req.schemaName, system: req.system, input: req.input, attempt })).digest('hex');
  return {
    mode,
    async replay(req, attempt = 1) {
      if (mode === 'off') return null;
      const [row] = await db.select({ response: llmRecords.response }).from(llmRecords).where(eq(llmRecords.key, keyOf(req, attempt))).limit(1);
      if (!row) return null;
      // 답 형식이 바뀌어 맞지 않는 녹화는 쓰지 않음
      const parsed = req.schema.safeParse(row.response);
      return parsed.success ? parsed.data : null;
    },
    async record(req, value, attempt = 1) {
      try {
        const key = keyOf(req, attempt);
        // 같은 요청의 녹화가 이미 있고 지금 답 형식에 맞으면 그대로 둠. 형식이 바뀌어 맞지 않는 녹화는 새 답으로 바꿈 (그대로 두면 다시 녹화해도 계속 못 씀, 10/29)
        const [row] = await db.select({ response: llmRecords.response }).from(llmRecords).where(eq(llmRecords.key, key)).limit(1);
        if (row && req.schema.safeParse(row.response).success) return;
        await db
          .insert(llmRecords)
          .values({ key, purpose: req.schemaName, model, attempt, response: value })
          .onConflictDoUpdate({ target: llmRecords.key, set: { response: value as never } });
      } catch (err) {
        console.warn('LLM 녹화 실패 (회의·카드는 그대로 진행):', err instanceof Error ? err.message : err);
      }
    },
  };
}
