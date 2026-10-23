import { initChatModel } from 'langchain';
import { z } from 'zod';

export interface JsonRequest<T extends z.ZodType> {
  system: string;
  input: unknown;
  schema: T;
  schemaName: string;
  /** Claude 생각(adaptive thinking)의 세기. 없으면 생각을 끔 (다른 공급자에는 보내지 않음) */
  thinking?: 'low' | 'medium' | 'high';
}

/** 글자 단위로 받은 응답 (시험 화면에서 LLM이 쓰는 과정을 보여 줄 때) */
export interface StreamedJson<T> {
  value: T;
  /** 실제로 답한 모델 (예비 모델로 넘어갔으면 그 모델) */
  model: string;
  text: string;
  /** input은 캐시 읽기·쓰기를 포함한 전체 입력 토큰. cacheRead·cacheWrite는 그중 캐시에서 읽은·캐시에 쓴 토큰 (Claude만) */
  usage: { input: number | null; output: number | null; cacheRead?: number; cacheWrite?: number };
  ms: number;
}

/** LLM이 정해진 JSON 형식으로만 답하게 하는 공통 창구 (공급자·모델은 환경 변수로 바꿈) */
export interface LlmClient {
  readonly name: string;
  generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>>;
  /** 같은 요청을 글자 단위로 받으며 onText(지금까지 받은 글자)를 부름. 결과 검사는 generateJson과 같음 */
  streamJson?<T extends z.ZodType>(req: JsonRequest<T>, onText: (text: string) => void): Promise<StreamedJson<z.infer<T>>>;
}

export interface ModelSpec {
  provider: string;
  model: string;
}

export interface LlmConfig extends ModelSpec {
  timeoutMs: number;
  /** 1회 호출 토큰 상한 (입력 + 출력) */
  callTokenLimit: number;
  /** 1회 응답(출력) 토큰 상한 */
  maxOutputTokens: number;
}

/** 지시문·응답 형식을 감싸는 메시지 틀에 드는 토큰 여유분 */
const MESSAGE_OVERHEAD_TOKENS = 500;

/**
 * 입력 토큰의 최댓값: 어떤 공급자의 토큰도 1바이트보다 짧지 않으므로 UTF-8 바이트 수가 상한임 (한글 1자 = 3바이트)
 * 지시문 + 사용자 입력 + 응답 형식(JSON 스키마)을 모두 셈
 */
export function inputTokenUpperBound(system: string, input: unknown, schema: z.ZodType): number {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  return bytes(system) + bytes(JSON.stringify(input)) + bytes(JSON.stringify(z.toJSONSchema(schema))) + MESSAGE_OVERHEAD_TOKENS;
}

export class LlmTokenLimitError extends Error {}

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
export async function createLangChainLlm({ provider, model, timeoutMs, callTokenLimit, maxOutputTokens }: LlmConfig): Promise<LlmClient> {
  const chat = await initChatModel(model, {
    modelProvider: provider,
    maxRetries: 1,
    maxTokens: maxOutputTokens,
    // Claude는 따로 끄지 않으면 생각(thinking)부터 해서 카드 1장에 4–7초 걸림. 끄면 약 2.7초 (10/14 실측, 다른 공급자에는 보내지 않음)
    ...(provider === 'anthropic' ? { thinking: { type: 'disabled' }, outputConfig: { effort: 'low' } } : {}),
  });
  // 요청이 생각을 바라면(4단계 AI 반응) 그 세기의 Claude를 한 번만 열어 둠. 10/19 비교 시험: 생각을 켜야 짐작으로 붙는 반응이 줄어듦
  const thinkers = new Map<string, Promise<typeof chat>>();
  const chatFor = (thinking: JsonRequest<z.ZodType>['thinking']) => {
    if (provider !== 'anthropic' || !thinking) return Promise.resolve(chat);
    if (!thinkers.has(thinking)) {
      thinkers.set(thinking, initChatModel(model, { modelProvider: provider, maxRetries: 1, maxTokens: maxOutputTokens, thinking: { type: 'adaptive' }, outputConfig: { effort: thinking } }));
    }
    return thinkers.get(thinking)!;
  };
  // 1회 호출 토큰 상한: 입력 최댓값 + 출력 상한이 넘으면 부르지 않음 (부르는 쪽이 규칙 카드로 대신함)
  const guard = (system: string, input: unknown, schema: z.ZodType) => {
    const upper = inputTokenUpperBound(system, input, schema);
    if (upper + maxOutputTokens > callTokenLimit) {
      throw new LlmTokenLimitError(`LLM 1회 토큰 상한 초과 예상 (입력 최대 ${upper} + 출력 ${maxOutputTokens} > ${callTokenLimit})`);
    }
  };
  // Claude: 지시문에 캐시 표시를 붙임. 같은 지시문이 5분 안에 다시 오면 그 부분 입력 단가가 1/10 (처음 한 번은 1.25배)
  // 10/17 실측: 분류표 3,103토큰을 두 번째 호출부터 캐시에서 읽음. 다른 공급자에는 글 그대로 보냄
  const messages = (system: string, input: unknown) => [
    { role: 'system', content: provider === 'anthropic' ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system },
    { role: 'user', content: JSON.stringify(input) },
  ];
  return {
    name: `${provider}:${model}`,
    async streamJson({ system, input, schema, schemaName, thinking }, onText) {
      guard(system, input, schema);
      const started = performance.now();
      const structured = (await chatFor(thinking)).withStructuredOutput(schema, { name: schemaName, method: 'jsonSchema' });
      let text = '';
      const usage: StreamedJson<unknown>['usage'] = { input: null, output: null };
      // 구조화 출력은 결과를 한 번에 돌려주므로, 안쪽 모델의 글자 조각(on_chat_model_stream)을 모아 보여 주고 끝에 직접 검사함
      for await (const ev of structured.streamEvents(messages(system, input), { version: 'v2', signal: AbortSignal.timeout(timeoutMs) })) {
        if (ev.event !== 'on_chat_model_stream') continue;
        const chunk = ev.data.chunk as { content?: unknown; usage_metadata?: { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number; cache_creation?: number } } };
        // 생각 글(thinking)은 답이 아니므로 모으지 않음
        const piece = typeof chunk.content === 'string' ? chunk.content : Array.isArray(chunk.content) ? chunk.content.map((p: { type?: string; text?: string }) => (p?.type === 'thinking' ? '' : (p?.text ?? ''))).join('') : '';
        if (chunk.usage_metadata) {
          usage.input = Math.max(usage.input ?? 0, chunk.usage_metadata.input_tokens ?? 0) || usage.input;
          usage.output = Math.max(usage.output ?? 0, chunk.usage_metadata.output_tokens ?? 0) || usage.output;
          const cache = chunk.usage_metadata.input_token_details;
          if (cache?.cache_read) usage.cacheRead = Math.max(usage.cacheRead ?? 0, cache.cache_read);
          if (cache?.cache_creation) usage.cacheWrite = Math.max(usage.cacheWrite ?? 0, cache.cache_creation);
        }
        if (piece) {
          text += piece;
          onText(text);
        }
      }
      return { value: schema.parse(JSON.parse(text)), model: `${provider}:${model}`, text, usage, ms: Math.round(performance.now() - started) };
    },
    async generateJson({ system, input, schema, schemaName, thinking }) {
      guard(system, input, schema);
      const structured = (await chatFor(thinking)).withStructuredOutput(schema, { name: schemaName, method: 'jsonSchema' });
      const raw = await structured.invoke(messages(system, input), { timeout: timeoutMs });
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
    async streamJson<T extends z.ZodType>(req: JsonRequest<T>, onText: (text: string) => void): Promise<StreamedJson<z.infer<T>>> {
      let lastError: unknown = new Error('사용할 LLM이 없음');
      for (const [i, client] of clients.entries()) {
        try {
          if (client.streamJson) return await client.streamJson(req, onText);
          const started = performance.now();
          const value = await client.generateJson(req);
          return { value, model: client.name, text: JSON.stringify(value), usage: { input: null, output: null }, ms: Math.round(performance.now() - started) };
        } catch (err) {
          lastError = err;
          const next = clients[i + 1];
          console.warn(`LLM ${client.name} 실패${next ? `, ${next.name}로 넘어감` : ''}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      throw lastError;
    },
  };
}
