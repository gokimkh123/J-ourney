import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db/client.js';
import { createLangChainLlm, type LlmClient, type ModelSpec, parseModelSpec, withFallbacks } from './llm/client.js';

if (!config.databaseUrl) console.warn('DATABASE_URL이 없어 DB 없이 실행함 (/health만 동작)');
const db = config.databaseUrl ? await connectDb(config.databaseUrl) : null;

// 기본 모델(LLM_PROVIDER·LLM_MODEL) 다음에 예비 모델(LLM_FALLBACKS)을 순서대로 엶. 열지 못한 모델은 건너뜀
const specs: ModelSpec[] = config.llmModel ? [{ provider: config.llmProvider, model: config.llmModel }] : [];
for (const spec of config.llmFallbacks) {
  const parsed = parseModelSpec(spec);
  if (parsed) specs.push(parsed);
  else console.warn(`LLM_FALLBACKS 형식이 틀려 건너뜀 (공급자:모델): ${spec}`);
}
const clients: LlmClient[] = [];
for (const spec of specs) {
  try {
    clients.push(await createLangChainLlm({ ...spec, timeoutMs: config.llmTimeoutMs }));
  } catch (err) {
    console.warn(`LLM ${spec.provider}:${spec.model}을 열지 못해 건너뜀:`, err instanceof Error ? err.message : err);
  }
}
const llm: LlmClient | null = clients.length ? withFallbacks(clients) : null;
console.log(`LLM: ${llm ? llm.name : '없음 (규칙 카드만 만듦)'}`);
if (!process.env.IP_HASH_SECRET) console.warn('IP_HASH_SECRET이 없어 임시 값을 씀 (서버를 다시 켜면 IP별 AI 횟수가 초기화됨)');

const app = createApp({
  db,
  devUi: config.devUi,
  llm,
  llmDailyLimit: config.llmDailyLimit,
  llmCardsPerMember: config.llmCardsPerMember,
  llmPerIpDaily: config.llmPerIpDaily,
  ipHashSecret: config.ipHashSecret,
  rateLimitPerMinute: config.rateLimitPerMinute,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`J-ourney 서버 실행 중: http://localhost:${info.port}/api/v1/health`);
  if (config.devUi) console.log(`백엔드 시험 화면: http://localhost:${info.port}/dev/`);
});
