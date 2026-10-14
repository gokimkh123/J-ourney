import { initChatModel } from 'langchain';
import type { z } from 'zod';

export interface JsonRequest<T extends z.ZodType> {
  system: string;
  input: unknown;
  schema: T;
  schemaName: string;
}

/** LLM이 정해진 JSON 형식으로만 답하게 하는 공통 창구 (공급자·모델은 환경 변수로 바꿈) */
export interface LlmClient {
  readonly name: string;
  generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>>;
}

export interface ModelSpec {
  provider: string;
  model: string;
}

export interface LlmConfig extends ModelSpec {
  timeoutMs: number;
}

/** 'google-genai:gemini-3.5-flash-lite' → { provider, model } (형식이 틀리면 null) */
export function parseModelSpec(spec: string): ModelSpec | null {
  const at = spec.indexOf(':');
  const provider = spec.slice(0, at).trim();
  const model = spec.slice(at + 1).trim();
  return at > 0 && provider && model ? { provider, model } : null;
}

/**
 * LangChain으로 모델을 엶. 공급자 패키지(@langchain/anthropic, @langchain/google-genai 등)를 설치하고
 * 공급자 이름과 모델 이름만 바꾸면 다른 회사 모델로 교체됨 (키는 각 패키지가 server/.env에서 읽음)
 */
export async function createLangChainLlm({ provider, model, timeoutMs }: LlmConfig): Promise<LlmClient> {
  const chat = await initChatModel(model, {
    modelProvider: provider,
    maxRetries: 1,
    // Claude는 따로 끄지 않으면 생각(thinking)부터 해서 카드 1장에 4–7초 걸림. 끄면 약 2.7초 (10/14 실측, 다른 공급자에는 보내지 않음)
    ...(provider === 'anthropic' ? { thinking: { type: 'disabled' }, outputConfig: { effort: 'low' } } : {}),
  });
  return {
    name: `${provider}:${model}`,
    async generateJson({ system, input, schema, schemaName }) {
      const structured = chat.withStructuredOutput(schema, { name: schemaName, method: 'jsonSchema' });
      const raw = await structured.invoke(
        [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
        { timeout: timeoutMs },
      );
      // 공급자가 지원하지 않아 빠진 제약(길이 등)까지 여기서 다시 검사함
      return schema.parse(raw);
    },
  };
}

/** 앞 모델이 실패하면 다음 모델로 넘어가는 창구 (예: Claude → Gemini). 모델마다 자기 시간 제한만큼만 기다림 */
export function withFallbacks(clients: LlmClient[]): LlmClient {
  return {
    name: clients.map((c) => c.name).join(' → '),
    async generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>> {
      let lastError: unknown = new Error('사용할 LLM이 없음');
      for (const [i, client] of clients.entries()) {
        const started = performance.now(); // 시계가 조정돼도 걸린 시간이 틀리지 않게 단조 시계를 씀
        try {
          const result = await client.generateJson(req);
          console.info(`LLM 응답: ${client.name} (${Math.round(performance.now() - started)}ms)`);
          return result;
        } catch (err) {
          lastError = err;
          const next = clients[i + 1];
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`LLM ${client.name} 실패 (${Math.round(performance.now() - started)}ms)${next ? `, ${next.name}로 넘어감` : ''}: ${reason}`);
        }
      }
      throw lastError;
    },
  };
}
