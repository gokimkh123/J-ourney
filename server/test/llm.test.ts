import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseModelSpec, withFallbacks } from '../src/llm/client.js';
import { fakeLlm } from './helpers.js';

const req = { system: '시험', input: {}, schema: z.object({ title: z.string() }), schemaName: 'test' };

describe('LLM 공급자 연결', () => {
  it("'공급자:모델' 형식을 읽음 (모델 이름 안의 ':'·'/'는 그대로 둠)", () => {
    expect(parseModelSpec('google-genai:gemini-3.5-flash-lite')).toEqual({ provider: 'google-genai', model: 'gemini-3.5-flash-lite' });
    expect(parseModelSpec('mistralai:mistral-small-latest')).toEqual({ provider: 'mistralai', model: 'mistral-small-latest' });
    expect(parseModelSpec('ollama:llama3:8b')).toEqual({ provider: 'ollama', model: 'llama3:8b' });
    expect(parseModelSpec('claude-haiku-5-5')).toBeNull();
    expect(parseModelSpec(':model')).toBeNull();
  });

  it('앞 모델이 실패하면 다음 모델의 답을 씀', async () => {
    const claude = fakeLlm(() => {
      throw new Error('overloaded');
    });
    const gemini = fakeLlm(() => ({ title: '예비 모델 카드' }));
    const llm = withFallbacks([claude, gemini]);
    await expect(llm.generateJson(req)).resolves.toEqual({ title: '예비 모델 카드' });
    expect([claude.calls, gemini.calls]).toEqual([1, 1]);
  });

  it('앞 모델이 성공하면 예비 모델은 부르지 않음, 모두 실패하면 마지막 오류를 던짐', async () => {
    const claude = fakeLlm(() => ({ title: '기본 모델 카드' }));
    const gemini = fakeLlm(() => ({ title: '쓰이지 않음' }));
    await expect(withFallbacks([claude, gemini]).generateJson(req)).resolves.toEqual({ title: '기본 모델 카드' });
    expect(gemini.calls).toBe(0);

    const down = (message: string) =>
      fakeLlm(() => {
        throw new Error(message);
      });
    await expect(withFallbacks([down('first'), down('last')]).generateJson(req)).rejects.toThrow('last');
  });
});
